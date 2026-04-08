const admin = require("firebase-admin");
const { FieldValue, Timestamp } = require("firebase-admin/firestore");
const { HttpsError, onCall } = require("firebase-functions/v2/https");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { logger } = require("firebase-functions/v2");

admin.initializeApp();
const db = admin.firestore();

const REGION = "us-central1";
const CALLABLE_OPTIONS = { region: REGION, cors: true };
const BOOKING_TTL_MINUTES = 15;
const PLATFORM_COMMISSION_RATE = 0.1;
const FLAT_HOURLY_RATE = 50;
const QR_TOKEN_TTL_MS = 60 * 1000;
const WEB_APP_BASE_URL = (process.env.WEB_APP_BASE_URL || "http://localhost:3000").replace(/\/+$/, "");

function nowMs() {
  return Date.now();
}

function ts(ms = nowMs()) {
  return Timestamp.fromMillis(ms);
}

function normalizePlate(plateNumber) {
  return String(plateNumber || "").trim().toUpperCase().replace(/\s+/g, " ");
}

function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function parseTimestampMs(value) {
  if (!value) return null;
  if (typeof value === "number") return value;
  if (value.toMillis) return value.toMillis();
  if (value.seconds) return value.seconds * 1000;
  return null;
}

function ensureParkingInvariant(parking) {
  const available = toNumber(parking.availableSlots, 0);
  const reserved = toNumber(parking.reservedSlots, 0);
  const occupied = toNumber(parking.occupiedSlots, 0);
  const capacity = toNumber(parking.slotCapacity, 0);
  return available + reserved + occupied === capacity;
}

async function getUserProfile(uid) {
  const snap = await db.collection("users").doc(uid).get();
  return snap.exists ? snap.data() : null;
}

async function requireRole(context, expectedRole) {
  if (!context.auth?.uid) {
    throw new HttpsError("unauthenticated", "Authentication required.");
  }
  const profile = await getUserProfile(context.auth.uid);
  if (!profile) throw new HttpsError("failed-precondition", "User profile not found.");
  if (profile.status && profile.status !== "active") {
    throw new HttpsError("permission-denied", "User is not active.");
  }
  if (profile.role !== expectedRole) {
    throw new HttpsError("permission-denied", `Required role: ${expectedRole}`);
  }
  return profile;
}

async function assertOperatorAssigned(uid, parkingId) {
  const profile = await getUserProfile(uid);
  const assigned = Array.isArray(profile?.assignedParkingIds) ? profile.assignedParkingIds : [];
  if (!assigned.includes(parkingId)) {
    throw new HttpsError("permission-denied", "Operator is not assigned to this parking.");
  }
}

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

async function assertOwnerControlsParking(ownerId, parkingId) {
  const parkingSnap = await db.collection("parkings").doc(parkingId).get();
  if (!parkingSnap.exists) {
    throw new HttpsError("not-found", `Parking ${parkingId} does not exist.`);
  }
  if (String(parkingSnap.data()?.ownerId || "") !== ownerId) {
    throw new HttpsError("permission-denied", `Parking ${parkingId} is not owned by this owner.`);
  }
}

async function writeAuditLog(action, actorUid, parkingId, metadata = {}) {
  await db.collection("auditLogs").add({
    action,
    actorUid,
    parkingId: parkingId || null,
    metadata,
    createdAt: ts(),
  });
}

function createRandomToken() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

async function completeCheckout({ actorUid, actorRole, parkingId, plateNumber, paymentMethod }) {
  const sessionQuery = await db
    .collection("sessions")
    .where("parkingId", "==", parkingId)
    .where("plateNumber", "==", plateNumber)
    .where("status", "==", "active")
    .limit(1)
    .get();
  if (sessionQuery.empty) throw new HttpsError("not-found", "No active session for this plate.");

  const sessionRef = sessionQuery.docs[0].ref;
  const parkingRef = db.collection("parkings").doc(parkingId);
  const paymentRef = db.collection("payments").doc();
  const now = nowMs();
  let result = null;

  await db.runTransaction(async (tx) => {
    const sessionSnap = await tx.get(sessionRef);
    if (!sessionSnap.exists) throw new HttpsError("not-found", "Session not found.");
    const session = sessionSnap.data();
    if (session.status !== "active") throw new HttpsError("failed-precondition", "Session already completed.");
    if (actorRole === "driver" && session.driverId !== actorUid) {
      throw new HttpsError("permission-denied", "Drivers can only checkout their own sessions.");
    }

    const parkingSnap = await tx.get(parkingRef);
    if (!parkingSnap.exists) throw new HttpsError("not-found", "Parking not found.");

    const entryMs = parseTimestampMs(session.entryTime);
    const durationMinutes = Math.max(1, Math.ceil((now - entryMs) / 60000));
    const billedHours = Math.max(1, Math.ceil(durationMinutes / 60));
    const feeAmount = billedHours * FLAT_HOURLY_RATE;
    const platformCommission = Math.round(feeAmount * PLATFORM_COMMISSION_RATE * 100) / 100;
    const ownerAmount = Math.round((feeAmount - platformCommission) * 100) / 100;

    tx.update(sessionRef, {
      status: "completed",
      exitTime: ts(now),
      durationMinutes,
      billedHours,
      hourlyRate: FLAT_HOURLY_RATE,
      feeAmount,
      paymentStatus: "confirmed",
      checkedOutBy: actorUid,
      checkedOutByRole: actorRole,
      updatedAt: ts(now),
    });

    tx.update(parkingRef, {
      occupiedSlots: FieldValue.increment(-1),
      availableSlots: FieldValue.increment(1),
      updatedAt: ts(now),
    });

    if (session.bookingId) {
      tx.set(
        db.collection("bookings").doc(session.bookingId),
        { status: "completed", checkOutAt: ts(now), updatedAt: ts(now) },
        { merge: true }
      );
    }

    tx.set(paymentRef, {
      sessionId: sessionRef.id,
      bookingId: session.bookingId || null,
      parkingId,
      ownerId: session.ownerId || null,
      grossAmount: feeAmount,
      platformCommission,
      ownerAmount,
      method: paymentMethod || (actorRole === "driver" ? "driver_self_checkout" : "manual"),
      status: "confirmed",
      paidAt: ts(now),
      confirmedBy: actorUid,
      createdAt: ts(now),
      updatedAt: ts(now),
    });

    result = {
      sessionId: sessionRef.id,
      paymentId: paymentRef.id,
      status: "completed",
      durationMinutes,
      billedHours,
      feeAmount,
    };
  });

  return result;
}

exports.createBooking = onCall(CALLABLE_OPTIONS, async (request) => {
  const actorUid = request.auth?.uid;
  const profile = await requireRole(request, "driver");
  const parkingId = String(request.data?.parkingId || "").trim();
  const plateNumber = normalizePlate(request.data?.plateNumber);

  if (!parkingId) throw new HttpsError("invalid-argument", "parkingId is required.");
  if (!plateNumber) throw new HttpsError("invalid-argument", "plateNumber is required.");

  const bookingRef = db.collection("bookings").doc();
  const parkingRef = db.collection("parkings").doc(parkingId);
  const now = nowMs();
  const expiresAt = now + BOOKING_TTL_MINUTES * 60 * 1000;

  await db.runTransaction(async (tx) => {
    const parkingSnap = await tx.get(parkingRef);
    if (!parkingSnap.exists) throw new HttpsError("not-found", "Parking not found.");
    const parking = parkingSnap.data();

    if (parking.status !== "active") throw new HttpsError("failed-precondition", "Parking is not active.");
    if (toNumber(parking.availableSlots) <= 0) throw new HttpsError("resource-exhausted", "No available slots.");
    if (!ensureParkingInvariant(parking)) throw new HttpsError("failed-precondition", "Parking counters invalid.");

    tx.set(bookingRef, {
      parkingId,
      ownerId: parking.ownerId || null,
      driverId: actorUid,
      driverEmail: profile.email || "",
      plateNumber,
      status: "reserved",
      reservedAt: ts(now),
      expiresAt: ts(expiresAt),
      checkInAt: null,
      checkOutAt: null,
      createdAt: ts(now),
      updatedAt: ts(now),
    });

    tx.update(parkingRef, {
      availableSlots: FieldValue.increment(-1),
      reservedSlots: FieldValue.increment(1),
      updatedAt: ts(now),
    });
  });

  await writeAuditLog("CREATE_BOOKING", actorUid, parkingId, { bookingId: bookingRef.id, plateNumber });
  return { bookingId: bookingRef.id, status: "reserved", expiresAt };
});

exports.expireBookings = onSchedule(
  { region: REGION, schedule: "every 5 minutes", timeZone: "Africa/Nairobi" },
  async () => {
    const now = ts();
    const snapshot = await db
      .collection("bookings")
      .where("status", "==", "reserved")
      .where("expiresAt", "<=", now)
      .limit(200)
      .get();

    let expiredCount = 0;
    for (const docSnap of snapshot.docs) {
      const bookingRef = docSnap.ref;
      const booking = docSnap.data();
      const parkingRef = db.collection("parkings").doc(booking.parkingId);

      await db.runTransaction(async (tx) => {
        const freshBooking = await tx.get(bookingRef);
        if (!freshBooking.exists || freshBooking.data().status !== "reserved") return;
        const parkingSnap = await tx.get(parkingRef);
        if (!parkingSnap.exists) return;

        tx.update(bookingRef, { status: "expired", updatedAt: ts() });
        tx.update(parkingRef, {
          reservedSlots: FieldValue.increment(-1),
          availableSlots: FieldValue.increment(1),
          updatedAt: ts(),
        });
      });
      expiredCount += 1;
    }

    logger.info("expireBookings completed", { expiredCount });
    return null;
  }
);

exports.checkInVehicle = onCall(CALLABLE_OPTIONS, async (request) => {
  const actorUid = request.auth?.uid;
  await requireRole(request, "operator");

  const parkingId = String(request.data?.parkingId || "").trim();
  const plateNumber = normalizePlate(request.data?.plateNumber);
  const allowWalkIn = !!request.data?.allowWalkIn;
  if (!parkingId || !plateNumber) throw new HttpsError("invalid-argument", "parkingId and plateNumber are required.");

  await assertOperatorAssigned(actorUid, parkingId);

  const activeSessionQuery = await db
    .collection("sessions")
    .where("parkingId", "==", parkingId)
    .where("plateNumber", "==", plateNumber)
    .where("status", "==", "active")
    .limit(1)
    .get();
  if (!activeSessionQuery.empty) throw new HttpsError("already-exists", "Vehicle already checked in.");

  const now = nowMs();
  const bookingQuery = await db
    .collection("bookings")
    .where("parkingId", "==", parkingId)
    .where("plateNumber", "==", plateNumber)
    .where("status", "==", "reserved")
    .orderBy("reservedAt", "desc")
    .limit(1)
    .get();

  const bookingDoc = bookingQuery.empty ? null : bookingQuery.docs[0];
  const bookingExpired = bookingDoc ? parseTimestampMs(bookingDoc.data().expiresAt) < now : false;

  const parkingRef = db.collection("parkings").doc(parkingId);
  const sessionRef = db.collection("sessions").doc();

  await db.runTransaction(async (tx) => {
    const parkingSnap = await tx.get(parkingRef);
    if (!parkingSnap.exists) throw new HttpsError("not-found", "Parking not found.");
    const parking = parkingSnap.data();

    if (parking.status !== "active") throw new HttpsError("failed-precondition", "Parking inactive.");
    if (!ensureParkingInvariant(parking)) throw new HttpsError("failed-precondition", "Parking counters invalid.");

    let bookingId = null;
    let driverId = null;

    if (bookingDoc && !bookingExpired) {
      const bookingRef = bookingDoc.ref;
      const currentBooking = await tx.get(bookingRef);
      if (currentBooking.exists && currentBooking.data().status === "reserved") {
        const booking = currentBooking.data();
        bookingId = bookingRef.id;
        driverId = booking.driverId || null;
        tx.update(bookingRef, { status: "checked_in", checkInAt: ts(now), updatedAt: ts(now) });
        tx.update(parkingRef, {
          reservedSlots: FieldValue.increment(-1),
          occupiedSlots: FieldValue.increment(1),
          updatedAt: ts(now),
        });
      }
    } else if (bookingDoc && bookingExpired) {
      const bookingRef = bookingDoc.ref;
      tx.update(bookingRef, { status: "expired", updatedAt: ts(now) });
      tx.update(parkingRef, {
        reservedSlots: FieldValue.increment(-1),
        availableSlots: FieldValue.increment(1),
        updatedAt: ts(now),
      });
    }

    if (!bookingId) {
      if (!allowWalkIn) {
        throw new HttpsError("failed-precondition", "No active reservation. Enable walk-in to proceed.");
      }
      if (toNumber(parking.availableSlots) <= 0) {
        throw new HttpsError("resource-exhausted", "No available slots for walk-in.");
      }
      tx.update(parkingRef, {
        availableSlots: FieldValue.increment(-1),
        occupiedSlots: FieldValue.increment(1),
        updatedAt: ts(now),
      });
    }

    tx.set(sessionRef, {
      parkingId,
      bookingId,
      ownerId: parking.ownerId || null,
      driverId,
      plateNumber,
      entryTime: ts(now),
      exitTime: null,
      durationMinutes: null,
      billedHours: null,
      hourlyRate: FLAT_HOURLY_RATE,
      feeAmount: null,
      paymentStatus: "pending",
      status: "active",
      checkedInBy: actorUid,
      checkedOutBy: null,
      createdAt: ts(now),
      updatedAt: ts(now),
    });
  });

  await writeAuditLog("CHECK_IN_VEHICLE", actorUid, parkingId, { plateNumber, sessionId: sessionRef.id });
  return { sessionId: sessionRef.id, status: "active" };
});

exports.checkOutVehicle = onCall(CALLABLE_OPTIONS, async (request) => {
  const actorUid = request.auth?.uid;
  await requireRole(request, "operator");

  const parkingId = String(request.data?.parkingId || "").trim();
  const plateNumber = normalizePlate(request.data?.plateNumber);
  if (!parkingId || !plateNumber) throw new HttpsError("invalid-argument", "parkingId and plateNumber are required.");

  await assertOperatorAssigned(actorUid, parkingId);
  const result = await completeCheckout({
    actorUid,
    actorRole: "operator",
    parkingId,
    plateNumber,
    paymentMethod: request.data?.paymentMethod || "manual",
  });

  await writeAuditLog("CHECK_OUT_VEHICLE", actorUid, parkingId, {
    plateNumber,
    sessionId: result.sessionId,
    paymentId: result.paymentId,
    feeAmount: result.feeAmount,
  });
  return result;
});

exports.driverCheckOutVehicle = onCall(CALLABLE_OPTIONS, async (request) => {
  const actorUid = request.auth?.uid;
  await requireRole(request, "driver");

  const parkingId = String(request.data?.parkingId || "").trim();
  const plateNumber = normalizePlate(request.data?.plateNumber);
  if (!parkingId || !plateNumber) throw new HttpsError("invalid-argument", "parkingId and plateNumber are required.");

  const result = await completeCheckout({
    actorUid,
    actorRole: "driver",
    parkingId,
    plateNumber,
    paymentMethod: "driver_self_checkout",
  });

  await writeAuditLog("DRIVER_CHECK_OUT_VEHICLE", actorUid, parkingId, {
    plateNumber,
    sessionId: result.sessionId,
    paymentId: result.paymentId,
    feeAmount: result.feeAmount,
  });
  return result;
});

exports.createParkingCheckInToken = onCall(CALLABLE_OPTIONS, async (request) => {
  const actorUid = request.auth?.uid;
  await requireRole(request, "operator");

  const parkingId = String(request.data?.parkingId || "").trim();
  if (!parkingId) throw new HttpsError("invalid-argument", "parkingId is required.");
  await assertOperatorAssigned(actorUid, parkingId);

  const now = nowMs();
  const token = createRandomToken();
  const tokenRef = db.collection("checkInTokens").doc(token);
  const requestOrigin = (request.rawRequest.get("origin") || WEB_APP_BASE_URL).replace(/\/+$/, "");
  const deepLink = `${requestOrigin}/driver/checkin-confirm?token=${encodeURIComponent(token)}`;

  await tokenRef.set({
    tokenId: token,
    parkingId,
    operatorUid: actorUid,
    status: "active",
    expiresAt: ts(now + QR_TOKEN_TTL_MS),
    usedAt: null,
    usedByDriverUid: null,
    requestId: null,
    createdAt: ts(now),
    updatedAt: ts(now),
  });

  await writeAuditLog("CREATE_PARKING_CHECKIN_TOKEN", actorUid, parkingId, { tokenId: token });
  return { tokenId: token, parkingId, expiresAtMs: now + QR_TOKEN_TTL_MS, deepLink };
});

exports.confirmCheckInFromQr = onCall(CALLABLE_OPTIONS, async (request) => {
  const actorUid = request.auth?.uid;
  const driverProfile = await requireRole(request, "driver");

  const tokenId = String(request.data?.token || "").trim();
  const plateNumber = normalizePlate(request.data?.plateNumber);
  if (!tokenId || !plateNumber) {
    throw new HttpsError("invalid-argument", "token and plateNumber are required.");
  }

  const tokenRef = db.collection("checkInTokens").doc(tokenId);
  const now = nowMs();
  let responseData = null;

  await db.runTransaction(async (tx) => {
    const tokenSnap = await tx.get(tokenRef);
    if (!tokenSnap.exists) throw new HttpsError("not-found", "Invalid QR token.");
    const token = tokenSnap.data();
    const tokenExpiresMs = parseTimestampMs(token.expiresAt);
    if (token.status === "used" && token.usedByDriverUid === actorUid && token.requestId) {
      responseData = { requestId: token.requestId, status: "pending", parkingId: token.parkingId };
      return;
    }
    if (token.status !== "active" || tokenExpiresMs <= now) {
      tx.update(tokenRef, { status: "expired", updatedAt: ts(now) });
      throw new HttpsError("failed-precondition", "QR token expired. Ask operator to refresh.");
    }

    const parkingRef = db.collection("parkings").doc(token.parkingId);
    const parkingSnap = await tx.get(parkingRef);
    if (!parkingSnap.exists) throw new HttpsError("not-found", "Parking not found.");
    const parking = parkingSnap.data();
    if (parking.status !== "active") throw new HttpsError("failed-precondition", "Parking inactive.");
    if (toNumber(parking.availableSlots) <= 0) throw new HttpsError("resource-exhausted", "No available slots.");
    if (!ensureParkingInvariant(parking)) throw new HttpsError("failed-precondition", "Parking counters invalid.");

    const existingRequestQuery = db
      .collection("checkInRequests")
      .where("driverUid", "==", actorUid)
      .where("status", "==", "pending")
      .limit(20);
    const existingRequestSnap = await tx.get(existingRequestQuery);
    const existingRequest = existingRequestSnap.docs.find((doc) => doc.data().parkingId === token.parkingId);
    if (existingRequest) {
      tx.update(tokenRef, {
        status: "used",
        usedAt: ts(now),
        usedByDriverUid: actorUid,
        requestId: existingRequest.id,
        updatedAt: ts(now),
      });
      responseData = { requestId: existingRequest.id, status: "pending", parkingId: token.parkingId };
      return;
    }

    const existingBookingQuery = db
      .collection("bookings")
      .where("driverId", "==", actorUid)
      .where("status", "==", "reserved")
      .orderBy("reservedAt", "desc")
      .limit(20);
    const existingBookingSnap = await tx.get(existingBookingQuery);

    let bookingDoc = null;
    existingBookingSnap.docs.forEach((doc) => {
      const data = doc.data();
      if (!bookingDoc && data.parkingId === token.parkingId && data.plateNumber === plateNumber) {
        bookingDoc = doc;
      }
    });

    let bookingRef = bookingDoc ? bookingDoc.ref : null;
    let autoCreatedBooking = false;
    if (!bookingRef) {
      bookingRef = db.collection("bookings").doc();
      autoCreatedBooking = true;
      tx.set(bookingRef, {
        parkingId: token.parkingId,
        ownerId: parking.ownerId || null,
        driverId: actorUid,
        driverEmail: driverProfile.email || "",
        plateNumber,
        status: "reserved",
        reservedAt: ts(now),
        expiresAt: ts(now + BOOKING_TTL_MINUTES * 60 * 1000),
        checkInAt: null,
        checkOutAt: null,
        createdAt: ts(now),
        updatedAt: ts(now),
      });
      tx.update(parkingRef, {
        availableSlots: FieldValue.increment(-1),
        reservedSlots: FieldValue.increment(1),
        updatedAt: ts(now),
      });
    }

    const requestRef = db.collection("checkInRequests").doc();
    tx.set(requestRef, {
      requestId: requestRef.id,
      parkingId: token.parkingId,
      ownerId: parking.ownerId || null,
      operatorUid: token.operatorUid || null,
      driverUid: actorUid,
      bookingId: bookingRef.id,
      plateNumber,
      tokenId,
      autoCreatedBooking,
      status: "pending",
      createdAt: ts(now),
      updatedAt: ts(now),
      approvedAt: null,
      rejectedAt: null,
      rejectedReason: null,
    });

    tx.update(tokenRef, {
      status: "used",
      usedAt: ts(now),
      usedByDriverUid: actorUid,
      requestId: requestRef.id,
      updatedAt: ts(now),
    });

    responseData = { requestId: requestRef.id, status: "pending", parkingId: token.parkingId };
  });

  await writeAuditLog("CONFIRM_CHECKIN_FROM_QR", actorUid, responseData?.parkingId, {
    requestId: responseData?.requestId || null,
    plateNumber,
  });
  return responseData;
});

exports.approveCheckInRequest = onCall(CALLABLE_OPTIONS, async (request) => {
  const actorUid = request.auth?.uid;
  await requireRole(request, "operator");

  const requestId = String(request.data?.requestId || "").trim();
  if (!requestId) throw new HttpsError("invalid-argument", "requestId is required.");

  const checkInRequestRef = db.collection("checkInRequests").doc(requestId);
  const now = nowMs();
  let responseData = null;

  const preSnap = await checkInRequestRef.get();
  if (!preSnap.exists) throw new HttpsError("not-found", "Check-in request not found.");
  await assertOperatorAssigned(actorUid, preSnap.data().parkingId);

  await db.runTransaction(async (tx) => {
    const reqSnap = await tx.get(checkInRequestRef);
    if (!reqSnap.exists) throw new HttpsError("not-found", "Check-in request not found.");
    const checkInRequest = reqSnap.data();
    if (checkInRequest.status !== "pending") {
      throw new HttpsError("failed-precondition", "Request is no longer pending.");
    }

    const parkingRef = db.collection("parkings").doc(checkInRequest.parkingId);
    const bookingRef = db.collection("bookings").doc(checkInRequest.bookingId);
    const sessionRef = db.collection("sessions").doc();

    const parkingSnap = await tx.get(parkingRef);
    if (!parkingSnap.exists) throw new HttpsError("not-found", "Parking not found.");
    const parking = parkingSnap.data();
    if (parking.status !== "active") throw new HttpsError("failed-precondition", "Parking inactive.");
    if (!ensureParkingInvariant(parking)) throw new HttpsError("failed-precondition", "Parking counters invalid.");

    const bookingSnap = await tx.get(bookingRef);
    if (!bookingSnap.exists) throw new HttpsError("not-found", "Booking not found for check-in request.");
    const booking = bookingSnap.data();
    if (booking.status !== "reserved") {
      throw new HttpsError("failed-precondition", "Booking is not reserved anymore.");
    }

    const activeSessionQuery = db
      .collection("sessions")
      .where("parkingId", "==", checkInRequest.parkingId)
      .where("plateNumber", "==", checkInRequest.plateNumber)
      .where("status", "==", "active")
      .limit(1);
    const activeSessionSnap = await tx.get(activeSessionQuery);
    if (!activeSessionSnap.empty) throw new HttpsError("already-exists", "Vehicle already checked in.");

    tx.update(bookingRef, {
      status: "checked_in",
      checkInAt: ts(now),
      updatedAt: ts(now),
    });

    tx.update(parkingRef, {
      reservedSlots: FieldValue.increment(-1),
      occupiedSlots: FieldValue.increment(1),
      updatedAt: ts(now),
    });

    tx.set(sessionRef, {
      parkingId: checkInRequest.parkingId,
      bookingId: checkInRequest.bookingId,
      ownerId: checkInRequest.ownerId || booking.ownerId || null,
      driverId: checkInRequest.driverUid,
      plateNumber: checkInRequest.plateNumber,
      entryTime: ts(now),
      exitTime: null,
      durationMinutes: null,
      billedHours: null,
      hourlyRate: FLAT_HOURLY_RATE,
      feeAmount: null,
      paymentStatus: "pending",
      status: "active",
      checkedInBy: actorUid,
      checkedOutBy: null,
      createdAt: ts(now),
      updatedAt: ts(now),
    });

    tx.update(checkInRequestRef, {
      status: "approved",
      approvedBy: actorUid,
      approvedAt: ts(now),
      sessionId: sessionRef.id,
      updatedAt: ts(now),
    });

    responseData = { requestId, sessionId: sessionRef.id, status: "approved", parkingId: checkInRequest.parkingId };
  });

  await writeAuditLog("APPROVE_CHECKIN_REQUEST", actorUid, responseData?.parkingId, {
    requestId,
    sessionId: responseData?.sessionId || null,
  });
  return responseData;
});

exports.rejectCheckInRequest = onCall(CALLABLE_OPTIONS, async (request) => {
  const actorUid = request.auth?.uid;
  await requireRole(request, "operator");

  const requestId = String(request.data?.requestId || "").trim();
  if (!requestId) throw new HttpsError("invalid-argument", "requestId is required.");

  const checkInRequestRef = db.collection("checkInRequests").doc(requestId);
  const now = nowMs();
  let responseData = null;

  const preSnap = await checkInRequestRef.get();
  if (!preSnap.exists) throw new HttpsError("not-found", "Check-in request not found.");
  await assertOperatorAssigned(actorUid, preSnap.data().parkingId);

  await db.runTransaction(async (tx) => {
    const reqSnap = await tx.get(checkInRequestRef);
    if (!reqSnap.exists) throw new HttpsError("not-found", "Check-in request not found.");
    const checkInRequest = reqSnap.data();
    if (checkInRequest.status !== "pending") {
      throw new HttpsError("failed-precondition", "Request is no longer pending.");
    }
    const parkingRef = db.collection("parkings").doc(checkInRequest.parkingId);
    const bookingRef = db.collection("bookings").doc(checkInRequest.bookingId);

    tx.update(checkInRequestRef, {
      status: "rejected",
      rejectedBy: actorUid,
      rejectedAt: ts(now),
      rejectedReason: String(request.data?.reason || "Operator rejected"),
      updatedAt: ts(now),
    });

    if (checkInRequest.autoCreatedBooking) {
      const bookingSnap = await tx.get(bookingRef);
      if (bookingSnap.exists && bookingSnap.data().status === "reserved") {
        tx.update(bookingRef, {
          status: "cancelled",
          updatedAt: ts(now),
        });
        tx.update(parkingRef, {
          reservedSlots: FieldValue.increment(-1),
          availableSlots: FieldValue.increment(1),
          updatedAt: ts(now),
        });
      }
    }

    responseData = { requestId, status: "rejected", parkingId: checkInRequest.parkingId };
  });

  await writeAuditLog("REJECT_CHECKIN_REQUEST", actorUid, responseData?.parkingId, { requestId });
  return responseData;
});

exports.createOwnerProfile = onCall(CALLABLE_OPTIONS, async (request) => {
  const actorUid = request.auth?.uid;
  await requireRole(request, "admin");

  const ownerId = String(request.data?.ownerId || "").trim();
  const userId = String(request.data?.userId || "").trim();
  const fullName = String(request.data?.fullName || "").trim();
  const email = String(request.data?.email || "").trim();
  const phone = String(request.data?.phone || "").trim();
  const bankAccountNumber = String(request.data?.bankAccountNumber || "").trim();

  if (!ownerId || !userId || !fullName || !email) {
    throw new HttpsError("invalid-argument", "ownerId, userId, fullName, and email are required.");
  }

  const ownerRef = db.collection("owners").doc(ownerId);
  const userRef = db.collection("users").doc(userId);

  await db.runTransaction(async (tx) => {
    const userSnap = await tx.get(userRef);
    if (!userSnap.exists) throw new HttpsError("not-found", "Target user not found.");

    tx.set(
      ownerRef,
      {
        ownerId,
        userId,
        fullName,
        email,
        phone,
        bankAccountNumber,
        status: "active",
        createdAt: ts(),
        updatedAt: ts(),
      },
      { merge: true }
    );

    tx.set(
      userRef,
      {
        role: "owner",
        ownerId,
        status: "active",
        updatedAt: Date.now(),
      },
      { merge: true }
    );
  });

  await writeAuditLog("CREATE_OWNER_PROFILE", actorUid, null, { ownerId, userId });
  return { ownerId, userId, status: "active" };
});

exports.upsertParking = onCall(CALLABLE_OPTIONS, async (request) => {
  const actorUid = request.auth?.uid;
  await requireRole(request, "admin");

  const parkingIdInput = String(request.data?.parkingId || "").trim();
  const ownerId = String(request.data?.ownerId || "").trim();
  const name = String(request.data?.name || "").trim();
  const address = String(request.data?.address || "").trim();
  const status = String(request.data?.status || "active").trim();
  const slotCapacity = toNumber(request.data?.slotCapacity, 0);
  const availableSlots = toNumber(request.data?.availableSlots, slotCapacity);
  const reservedSlots = toNumber(request.data?.reservedSlots, 0);
  const occupiedSlots = toNumber(request.data?.occupiedSlots, 0);
  const hourlyRate = toNumber(request.data?.hourlyRate, 50);
  const lat = toNumber(request.data?.lat, null);
  const lng = toNumber(request.data?.lng, null);

  if (!ownerId || !name) throw new HttpsError("invalid-argument", "ownerId and name are required.");
  if (slotCapacity < 0 || hourlyRate < 0) throw new HttpsError("invalid-argument", "slotCapacity/hourlyRate must be non-negative.");
  if (availableSlots + reservedSlots + occupiedSlots !== slotCapacity) {
    throw new HttpsError("invalid-argument", "Parking counters must satisfy available+reserved+occupied=slotCapacity.");
  }

  const parkingRef = parkingIdInput ? db.collection("parkings").doc(parkingIdInput) : db.collection("parkings").doc();
  await parkingRef.set(
    {
      ownerId,
      name,
      address,
      status,
      slotCapacity,
      availableSlots,
      reservedSlots,
      occupiedSlots,
      hourlyRate,
      location: lat != null && lng != null ? { lat, lng } : null,
      updatedAt: ts(),
      createdAt: ts(),
    },
    { merge: true }
  );

  await writeAuditLog("UPSERT_PARKING", actorUid, parkingRef.id, { ownerId });
  return { parkingId: parkingRef.id, status };
});

exports.assignOperatorToParking = onCall(CALLABLE_OPTIONS, async (request) => {
  const actorUid = request.auth?.uid;
  await requireRole(request, "admin");

  const operatorUid = String(request.data?.operatorUid || "").trim();
  const parkingId = String(request.data?.parkingId || "").trim();
  const assign = request.data?.assign !== false;
  if (!operatorUid || !parkingId) throw new HttpsError("invalid-argument", "operatorUid and parkingId are required.");

  const userRef = db.collection("users").doc(operatorUid);
  const parkingRef = db.collection("parkings").doc(parkingId);

  await db.runTransaction(async (tx) => {
    const userSnap = await tx.get(userRef);
    if (!userSnap.exists) throw new HttpsError("not-found", "Operator user not found.");
    const role = userSnap.data().role;
    if (role !== "operator") throw new HttpsError("failed-precondition", "Target user is not an operator.");

    const parkingSnap = await tx.get(parkingRef);
    if (!parkingSnap.exists) throw new HttpsError("not-found", "Parking not found.");

    tx.update(userRef, {
      assignedParkingIds: assign ? FieldValue.arrayUnion(parkingId) : FieldValue.arrayRemove(parkingId),
      updatedAt: Date.now(),
    });
  });

  await writeAuditLog("ASSIGN_OPERATOR_TO_PARKING", actorUid, parkingId, { operatorUid, assign });
  return { operatorUid, parkingId, assign };
});

exports.ownerCreateOperator = onCall(CALLABLE_OPTIONS, async (request) => {
  const actorUid = request.auth?.uid;
  const ownerProfile = await requireRole(request, "owner");
  const ownerId = String(ownerProfile.ownerId || "").trim();

  if (!ownerId) throw new HttpsError("failed-precondition", "Owner profile is missing ownerId.");

  const email = normalizeEmail(request.data?.email);
  const fullName = String(request.data?.fullName || "").trim();
  const password = String(request.data?.password || "").trim();
  const phone = String(request.data?.phone || "").trim();
  const assignedParkingIdsRaw = Array.isArray(request.data?.assignedParkingIds) ? request.data.assignedParkingIds : [];
  const assignedParkingIds = [...new Set(assignedParkingIdsRaw.map((id) => String(id || "").trim()).filter(Boolean))];

  if (!email || !fullName || !password) {
    throw new HttpsError("invalid-argument", "email, fullName, and password are required.");
  }
  if (password.length < 6) {
    throw new HttpsError("invalid-argument", "Password must be at least 6 characters.");
  }
  if (!assignedParkingIds.length) {
    throw new HttpsError("invalid-argument", "At least one parking assignment is required.");
  }

  for (const parkingId of assignedParkingIds) {
    await assertOwnerControlsParking(ownerId, parkingId);
  }

  let targetAuthUser = null;
  try {
    targetAuthUser = await admin.auth().getUserByEmail(email);
  } catch (error) {
    if (error.code !== "auth/user-not-found") {
      throw new HttpsError("internal", "Failed to lookup operator account.");
    }
  }

  if (!targetAuthUser) {
    targetAuthUser = await admin.auth().createUser({
      email,
      password,
      displayName: fullName,
    });
  }

  const operatorUid = targetAuthUser.uid;
  const operatorRef = db.collection("users").doc(operatorUid);

  await db.runTransaction(async (tx) => {
    const operatorSnap = await tx.get(operatorRef);
    const existing = operatorSnap.exists ? operatorSnap.data() : null;

    if (existing?.role && existing.role !== "operator") {
      throw new HttpsError("failed-precondition", "Existing user is not an operator.");
    }
    if (existing?.ownerId && existing.ownerId !== ownerId) {
      throw new HttpsError("permission-denied", "Operator is already bound to a different owner.");
    }

    tx.set(
      operatorRef,
      {
        fullName,
        email,
        phone,
        role: "operator",
        status: "active",
        ownerId,
        assignedParkingIds,
        createdByOwnerUid: actorUid,
        createdAt: existing?.createdAt || Date.now(),
        updatedAt: Date.now(),
      },
      { merge: true }
    );
  });

  await writeAuditLog("OWNER_CREATE_OPERATOR", actorUid, null, { operatorUid, ownerId, assignedParkingIds });
  return { operatorUid, ownerId, assignedParkingIds, status: "active" };
});

exports.ownerUpdateOperatorAssignments = onCall(CALLABLE_OPTIONS, async (request) => {
  const actorUid = request.auth?.uid;
  const ownerProfile = await requireRole(request, "owner");
  const ownerId = String(ownerProfile.ownerId || "").trim();
  if (!ownerId) throw new HttpsError("failed-precondition", "Owner profile is missing ownerId.");

  const operatorUid = String(request.data?.operatorUid || "").trim();
  const assignedParkingIdsRaw = Array.isArray(request.data?.assignedParkingIds) ? request.data.assignedParkingIds : [];
  const assignedParkingIds = [...new Set(assignedParkingIdsRaw.map((id) => String(id || "").trim()).filter(Boolean))];

  if (!operatorUid) throw new HttpsError("invalid-argument", "operatorUid is required.");
  if (!assignedParkingIds.length) {
    throw new HttpsError("invalid-argument", "At least one parking assignment is required.");
  }

  for (const parkingId of assignedParkingIds) {
    await assertOwnerControlsParking(ownerId, parkingId);
  }

  const operatorRef = db.collection("users").doc(operatorUid);
  await db.runTransaction(async (tx) => {
    const operatorSnap = await tx.get(operatorRef);
    if (!operatorSnap.exists) throw new HttpsError("not-found", "Operator user not found.");
    const operator = operatorSnap.data();
    if (operator.role !== "operator") throw new HttpsError("failed-precondition", "Target user is not an operator.");
    if (String(operator.ownerId || "") !== ownerId) {
      throw new HttpsError("permission-denied", "This operator does not belong to this owner.");
    }

    tx.update(operatorRef, {
      assignedParkingIds,
      updatedAt: Date.now(),
    });
  });

  await writeAuditLog("OWNER_UPDATE_OPERATOR_ASSIGNMENTS", actorUid, null, { operatorUid, ownerId, assignedParkingIds });
  return { operatorUid, assignedParkingIds };
});

exports.ownerSetOperatorStatus = onCall(CALLABLE_OPTIONS, async (request) => {
  const actorUid = request.auth?.uid;
  const ownerProfile = await requireRole(request, "owner");
  const ownerId = String(ownerProfile.ownerId || "").trim();
  if (!ownerId) throw new HttpsError("failed-precondition", "Owner profile is missing ownerId.");

  const operatorUid = String(request.data?.operatorUid || "").trim();
  const status = String(request.data?.status || "").trim().toLowerCase();
  if (!operatorUid) throw new HttpsError("invalid-argument", "operatorUid is required.");
  if (!["active", "inactive"].includes(status)) {
    throw new HttpsError("invalid-argument", "status must be active or inactive.");
  }

  const operatorRef = db.collection("users").doc(operatorUid);
  await db.runTransaction(async (tx) => {
    const operatorSnap = await tx.get(operatorRef);
    if (!operatorSnap.exists) throw new HttpsError("not-found", "Operator user not found.");
    const operator = operatorSnap.data();
    if (operator.role !== "operator") throw new HttpsError("failed-precondition", "Target user is not an operator.");
    if (String(operator.ownerId || "") !== ownerId) {
      throw new HttpsError("permission-denied", "This operator does not belong to this owner.");
    }

    tx.update(operatorRef, {
      status,
      updatedAt: Date.now(),
    });
  });

  await writeAuditLog("OWNER_SET_OPERATOR_STATUS", actorUid, null, { operatorUid, ownerId, status });
  return { operatorUid, status };
});
