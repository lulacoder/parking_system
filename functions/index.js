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

function roundMoney(value) {
  return Math.round(toNumber(value, 0) * 100) / 100;
}

function normalizeSplit(grossAmount, ownerAmount, platformCommission) {
  const gross = roundMoney(grossAmount);
  const commission = roundMoney(gross * PLATFORM_COMMISSION_RATE);
  const owner = roundMoney(gross - commission);

  return {
    grossAmount: gross,
    ownerAmount: ownerAmount == null ? owner : roundMoney(ownerAmount),
    platformCommission: platformCommission == null ? commission : roundMoney(platformCommission),
    adminCommissionDerived: commission,
  };
}

function parseAnalyticsRange(data) {
  const preset = String(data?.rangePreset || "30d").trim().toLowerCase();
  const now = new Date();
  let from = null;
  let to = now;

  if (preset === "7d") {
    from = new Date(now.getTime() - 6 * 24 * 60 * 60 * 1000);
  } else if (preset === "30d") {
    from = new Date(now.getTime() - 29 * 24 * 60 * 60 * 1000);
  } else if (preset === "custom") {
    const fromMs = toNumber(data?.fromMs, 0);
    const toMs = toNumber(data?.toMs, 0);
    if (!fromMs || !toMs) {
      throw new HttpsError("invalid-argument", "Custom range requires fromMs and toMs.");
    }
    from = new Date(fromMs);
    to = new Date(toMs);
  } else {
    throw new HttpsError("invalid-argument", "rangePreset must be 7d, 30d, or custom.");
  }

  from.setHours(0, 0, 0, 0);
  to.setHours(23, 59, 59, 999);

  if (from.getTime() > to.getTime()) {
    const tmp = from;
    from = to;
    to = tmp;
  }

  return {
    preset,
    fromMs: from.getTime(),
    toMs: to.getTime(),
  };
}

function dayKey(ms) {
  const d = new Date(ms);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function dayLabel(ms) {
  const d = new Date(ms);
  return `${d.toLocaleString("en-US", { month: "short" })} ${d.getDate()}`;
}

function buildSeriesSkeleton(fromMs, toMs) {
  const map = {};
  const cursor = new Date(fromMs);
  cursor.setHours(0, 0, 0, 0);
  while (cursor.getTime() <= toMs) {
    const ms = cursor.getTime();
    const key = dayKey(ms);
    map[key] = {
      key,
      label: dayLabel(ms),
      grossAmount: 0,
      ownerAmount: 0,
      adminCommission: 0,
      paymentsCount: 0,
    };
    cursor.setDate(cursor.getDate() + 1);
  }
  return map;
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

function normalizePaymentMethod(value) {
  const method = String(value || "").trim().toLowerCase();
  if (!["bank", "phone"].includes(method)) {
    throw new HttpsError("invalid-argument", "method must be either bank or phone.");
  }
  return method;
}

function computeSessionCharge(entryTimestamp, now) {
  const entryMs = parseTimestampMs(entryTimestamp);
  if (!entryMs) {
    throw new HttpsError("failed-precondition", "Session entry time is invalid.");
  }
  const durationMinutes = Math.max(1, Math.ceil((now - entryMs) / 60000));
  const billedHours = Math.max(1, Math.ceil(durationMinutes / 60));
  const amountDue = billedHours * FLAT_HOURLY_RATE;
  return { durationMinutes, billedHours, amountDue };
}

async function submitManualPaymentRequest({ actorUid, parkingId, plateNumber, method, referenceCode }) {
  const now = nowMs();
  const sessionQuery = await db
    .collection("sessions")
    .where("parkingId", "==", parkingId)
    .where("plateNumber", "==", plateNumber)
    .where("status", "==", "active")
    .limit(1)
    .get();
  if (sessionQuery.empty) {
    throw new HttpsError("not-found", "No active session found for this vehicle.");
  }

  const sessionRef = sessionQuery.docs[0].ref;
  const normalizedReference = String(referenceCode || "").trim();
  let responseData = null;

  await db.runTransaction(async (tx) => {
    const sessionSnap = await tx.get(sessionRef);
    if (!sessionSnap.exists) throw new HttpsError("not-found", "Session not found.");
    const session = sessionSnap.data();

    if (session.status !== "active") {
      throw new HttpsError("failed-precondition", "Session is not active.");
    }
    if (session.driverId !== actorUid) {
      throw new HttpsError("permission-denied", "Drivers can only submit payment for their own session.");
    }

    const charge = computeSessionCharge(session.entryTime, now);
    const ownerId = session.ownerId || null;

    const existingPendingQuery = db
      .collection("paymentRequests")
      .where("sessionId", "==", sessionRef.id)
      .where("status", "==", "pending")
      .limit(1);
    const existingPendingSnap = await tx.get(existingPendingQuery);
    if (!existingPendingSnap.empty) {
      throw new HttpsError("failed-precondition", "A payment request is already pending operator approval.");
    }

    const paymentRequestRef = db.collection("paymentRequests").doc();

    tx.set(
      paymentRequestRef,
      {
        sessionId: sessionRef.id,
        bookingId: session.bookingId || null,
        parkingId: session.parkingId,
        ownerId,
        driverId: actorUid,
        plateNumber: session.plateNumber,
        amountDue: charge.amountDue,
        billedHours: charge.billedHours,
        hourlyRate: FLAT_HOURLY_RATE,
        method,
        referenceCode: normalizedReference || null,
        status: "pending",
        submittedAt: ts(now),
        submittedBy: actorUid,
        confirmedAt: null,
        rejectedAt: null,
        confirmedBy: null,
        rejectedBy: null,
        rejectionReason: null,
        paymentId: null,
        createdAt: ts(now),
        updatedAt: ts(now),
      },
      { merge: false }
    );

    tx.update(sessionRef, {
      paymentStatus: "pending",
      updatedAt: ts(now),
    });

    responseData = {
      requestId: paymentRequestRef.id,
      sessionId: sessionRef.id,
      status: "pending",
      parkingId: session.parkingId,
      amountDue: charge.amountDue,
      feeAmount: charge.amountDue,
      billedHours: charge.billedHours,
      hourlyRate: FLAT_HOURLY_RATE,
    };
  });

  return responseData;
}

exports.listPendingPaymentsForOperator = onCall(CALLABLE_OPTIONS, async (request) => {
  const actorUid = request.auth?.uid;
  await requireRole(request, "operator");

  const parkingId = String(request.data?.parkingId || "").trim();
  if (!parkingId) throw new HttpsError("invalid-argument", "parkingId is required.");
  await assertOperatorAssigned(actorUid, parkingId);

  const snapshot = await db.collection("paymentRequests").where("parkingId", "==", parkingId).limit(200).get();
  const pending = snapshot.docs
    .map((doc) => ({ id: doc.id, ...doc.data() }))
    .filter((item) => item.status === "pending")
    .sort((a, b) => parseTimestampMs(b.submittedAt) - parseTimestampMs(a.submittedAt))
    .map((item) => ({
      id: item.id,
      sessionId: item.sessionId || null,
      bookingId: item.bookingId || null,
      parkingId: item.parkingId || null,
      driverId: item.driverId || null,
      plateNumber: item.plateNumber || null,
      amountDue: toNumber(item.amountDue, 0),
      billedHours: toNumber(item.billedHours, 0),
      hourlyRate: toNumber(item.hourlyRate, FLAT_HOURLY_RATE),
      method: item.method || null,
      referenceCode: item.referenceCode || null,
      submittedAtMs: parseTimestampMs(item.submittedAt),
    }));

  return { parkingId, pendingPayments: pending };
});

exports.listPendingPaymentsForDriver = onCall(CALLABLE_OPTIONS, async (request) => {
  const actorUid = request.auth?.uid;
  await requireRole(request, "driver");

  const snapshot = await db.collection("paymentRequests").where("driverId", "==", actorUid).limit(200).get();
  const pending = snapshot.docs
    .map((doc) => ({ id: doc.id, ...doc.data() }))
    .filter((item) => item.status === "pending")
    .sort((a, b) => parseTimestampMs(b.submittedAt) - parseTimestampMs(a.submittedAt))
    .map((item) => ({
      id: item.id,
      sessionId: item.sessionId || null,
      parkingId: item.parkingId || null,
      plateNumber: item.plateNumber || null,
      amountDue: toNumber(item.amountDue, 0),
      method: item.method || null,
      submittedAtMs: parseTimestampMs(item.submittedAt),
    }));

  return { pendingPayments: pending };
});

exports.getPendingPaymentForSession = onCall(CALLABLE_OPTIONS, async (request) => {
  const actorUid = request.auth?.uid;
  await requireRole(request, "operator");

  const sessionId = String(request.data?.sessionId || "").trim();
  if (!sessionId) throw new HttpsError("invalid-argument", "sessionId is required.");

  const sessionSnap = await db.collection("sessions").doc(sessionId).get();
  if (!sessionSnap.exists) throw new HttpsError("not-found", "Session not found.");
  const session = sessionSnap.data();
  const parkingId = String(session.parkingId || "").trim();
  if (!parkingId) throw new HttpsError("failed-precondition", "Session parkingId is missing.");
  await assertOperatorAssigned(actorUid, parkingId);

  const snapshot = await db
    .collection("paymentRequests")
    .where("sessionId", "==", sessionId)
    .where("status", "==", "pending")
    .limit(1)
    .get();

  if (snapshot.empty) {
    throw new HttpsError("not-found", "No pending payment request found for this session.");
  }

  const doc = snapshot.docs[0];
  const payload = doc.data();
  return {
    pendingPayment: {
      id: doc.id,
      sessionId: payload.sessionId || sessionId,
      bookingId: payload.bookingId || null,
      parkingId: payload.parkingId || parkingId,
      driverId: payload.driverId || null,
      plateNumber: payload.plateNumber || session.plateNumber || null,
      amountDue: toNumber(payload.amountDue, 0),
      billedHours: toNumber(payload.billedHours, 0),
      hourlyRate: toNumber(payload.hourlyRate, FLAT_HOURLY_RATE),
      method: payload.method || null,
      referenceCode: payload.referenceCode || null,
      submittedAtMs: parseTimestampMs(payload.submittedAt),
    },
  };
});

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
      paymentStatus: "unpaid",
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
  await requireRole(request, "operator");
  throw new HttpsError(
    "failed-precondition",
    "Direct operator checkout is disabled. Please confirm payment from the Pending Payments queue."
  );
});

exports.submitManualPayment = onCall(CALLABLE_OPTIONS, async (request) => {
  const actorUid = request.auth?.uid;
  await requireRole(request, "driver");

  const parkingId = String(request.data?.parkingId || "").trim();
  const plateNumber = normalizePlate(request.data?.plateNumber);
  const method = normalizePaymentMethod(request.data?.method || "bank");
  const referenceCode = String(request.data?.referenceCode || "").trim();

  if (!parkingId || !plateNumber) {
    throw new HttpsError("invalid-argument", "parkingId and plateNumber are required.");
  }

  const result = await submitManualPaymentRequest({
    actorUid,
    parkingId,
    plateNumber,
    method,
    referenceCode,
  });

  await writeAuditLog("SUBMIT_MANUAL_PAYMENT", actorUid, parkingId, {
    requestId: result.requestId,
    sessionId: result.sessionId,
    method,
    amountDue: result.amountDue,
  });
  return result;
});

exports.driverCheckOutVehicle = onCall(CALLABLE_OPTIONS, async (request) => {
  const actorUid = request.auth?.uid;
  await requireRole(request, "driver");

  const parkingId = String(request.data?.parkingId || "").trim();
  const plateNumber = normalizePlate(request.data?.plateNumber);
  const method = normalizePaymentMethod(request.data?.method || "bank");
  const referenceCode = String(request.data?.referenceCode || "").trim();
  if (!parkingId || !plateNumber) throw new HttpsError("invalid-argument", "parkingId and plateNumber are required.");

  const result = await submitManualPaymentRequest({
    actorUid,
    parkingId,
    plateNumber,
    method,
    referenceCode,
  });

  await writeAuditLog("DRIVER_SUBMIT_MANUAL_PAYMENT", actorUid, parkingId, {
    requestId: result.requestId,
    sessionId: result.sessionId,
    method,
    amountDue: result.amountDue,
  });
  return result;
});

exports.confirmManualPayment = onCall(CALLABLE_OPTIONS, async (request) => {
  const actorUid = request.auth?.uid;
  await requireRole(request, "operator");

  const requestId = String(request.data?.requestId || "").trim();
  if (!requestId) throw new HttpsError("invalid-argument", "requestId is required.");

  const paymentRequestRef = db.collection("paymentRequests").doc(requestId);
  const now = nowMs();
  let responseData = null;

  const preSnap = await paymentRequestRef.get();
  if (!preSnap.exists) throw new HttpsError("not-found", "Payment request not found.");
  await assertOperatorAssigned(actorUid, preSnap.data().parkingId);

  await db.runTransaction(async (tx) => {
    const reqSnap = await tx.get(paymentRequestRef);
    if (!reqSnap.exists) throw new HttpsError("not-found", "Payment request not found.");
    const paymentRequest = reqSnap.data();

    if (paymentRequest.status === "confirmed") {
      responseData = {
        requestId,
        sessionId: paymentRequest.sessionId,
        paymentId: paymentRequest.paymentId || requestId,
        status: "confirmed",
        amountDue: paymentRequest.amountDue,
        alreadyConfirmed: true,
      };
      return;
    }
    if (paymentRequest.status !== "pending") {
      throw new HttpsError("failed-precondition", "Only pending payment requests can be confirmed.");
    }

    const sessionRef = db.collection("sessions").doc(paymentRequest.sessionId);
    const parkingRef = db.collection("parkings").doc(paymentRequest.parkingId);
    const bookingRef = paymentRequest.bookingId ? db.collection("bookings").doc(paymentRequest.bookingId) : null;
    const paymentRef = db.collection("payments").doc(requestId);

    const [sessionSnap, parkingSnap] = await Promise.all([tx.get(sessionRef), tx.get(parkingRef)]);
    if (!sessionSnap.exists) throw new HttpsError("not-found", "Session not found.");
    if (!parkingSnap.exists) throw new HttpsError("not-found", "Parking not found.");

    const session = sessionSnap.data();
    if (session.status !== "active") {
      throw new HttpsError("failed-precondition", "Session is already closed.");
    }

    const charge = computeSessionCharge(session.entryTime, now);
    const feeAmount = charge.amountDue;
    const platformCommission = Math.round(feeAmount * PLATFORM_COMMISSION_RATE * 100) / 100;
    const ownerAmount = Math.round((feeAmount - platformCommission) * 100) / 100;

    tx.update(sessionRef, {
      status: "completed",
      exitTime: ts(now),
      durationMinutes: charge.durationMinutes,
      billedHours: charge.billedHours,
      hourlyRate: FLAT_HOURLY_RATE,
      feeAmount,
      paymentStatus: "confirmed",
      checkedOutBy: actorUid,
      checkedOutByRole: "operator",
      updatedAt: ts(now),
    });

    tx.update(parkingRef, {
      occupiedSlots: FieldValue.increment(-1),
      availableSlots: FieldValue.increment(1),
      updatedAt: ts(now),
    });

    if (bookingRef) {
      tx.set(
        bookingRef,
        {
          status: "completed",
          checkOutAt: ts(now),
          updatedAt: ts(now),
        },
        { merge: true }
      );
    }

    tx.set(
      paymentRef,
      {
        sessionId: sessionRef.id,
        bookingId: paymentRequest.bookingId || null,
        parkingId: paymentRequest.parkingId,
        ownerId: paymentRequest.ownerId || null,
        driverId: paymentRequest.driverId || null,
        grossAmount: feeAmount,
        platformCommission,
        ownerAmount,
        method: paymentRequest.method || "manual",
        status: "confirmed",
        paidAt: ts(now),
        confirmedBy: actorUid,
        createdAt: ts(now),
        updatedAt: ts(now),
      },
      { merge: true }
    );

    tx.update(paymentRequestRef, {
      status: "confirmed",
      amountDue: feeAmount,
      billedHours: charge.billedHours,
      hourlyRate: FLAT_HOURLY_RATE,
      confirmedAt: ts(now),
      confirmedBy: actorUid,
      rejectionReason: null,
      rejectedAt: null,
      rejectedBy: null,
      paymentId: paymentRef.id,
      updatedAt: ts(now),
    });

    responseData = {
      requestId,
      sessionId: sessionRef.id,
      paymentId: paymentRef.id,
      status: "confirmed",
      feeAmount,
      billedHours: charge.billedHours,
    };
  });

  await writeAuditLog("CONFIRM_MANUAL_PAYMENT", actorUid, preSnap.data().parkingId, {
    requestId,
    sessionId: responseData?.sessionId || null,
    paymentId: responseData?.paymentId || null,
    feeAmount: responseData?.feeAmount || null,
  });

  return responseData;
});

exports.rejectManualPayment = onCall(CALLABLE_OPTIONS, async (request) => {
  const actorUid = request.auth?.uid;
  await requireRole(request, "operator");

  const requestId = String(request.data?.requestId || "").trim();
  const reason = String(request.data?.reason || "Payment not verified").trim();
  if (!requestId) throw new HttpsError("invalid-argument", "requestId is required.");

  const paymentRequestRef = db.collection("paymentRequests").doc(requestId);
  const now = nowMs();
  let responseData = null;

  const preSnap = await paymentRequestRef.get();
  if (!preSnap.exists) throw new HttpsError("not-found", "Payment request not found.");
  await assertOperatorAssigned(actorUid, preSnap.data().parkingId);

  await db.runTransaction(async (tx) => {
    const reqSnap = await tx.get(paymentRequestRef);
    if (!reqSnap.exists) throw new HttpsError("not-found", "Payment request not found.");
    const paymentRequest = reqSnap.data();

    if (paymentRequest.status === "rejected") {
      responseData = { requestId, status: "rejected", alreadyRejected: true };
      return;
    }
    if (paymentRequest.status !== "pending") {
      throw new HttpsError("failed-precondition", "Only pending payment requests can be rejected.");
    }

    const sessionRef = db.collection("sessions").doc(paymentRequest.sessionId);
    tx.update(paymentRequestRef, {
      status: "rejected",
      rejectionReason: reason,
      rejectedBy: actorUid,
      rejectedAt: ts(now),
      updatedAt: ts(now),
    });
    tx.set(
      sessionRef,
      {
        paymentStatus: "unpaid",
        updatedAt: ts(now),
      },
      { merge: true }
    );

    responseData = { requestId, status: "rejected" };
  });

  await writeAuditLog("REJECT_MANUAL_PAYMENT", actorUid, preSnap.data().parkingId, {
    requestId,
    reason,
  });
  return responseData;
});

exports.getAdminAnalytics = onCall(CALLABLE_OPTIONS, async (request) => {
  await requireRole(request, "admin");
  const range = parseAnalyticsRange(request.data || {});

  const [ownersSnap, parkingsSnap, operatorsSnap, paymentsSnap, sessionsSnap, pendingRequestsSnap] = await Promise.all([
    db.collection("owners").get(),
    db.collection("parkings").get(),
    db.collection("users").where("role", "==", "operator").get(),
    db.collection("payments").where("status", "==", "confirmed").get(),
    db.collection("sessions").where("status", "==", "completed").get(),
    db.collection("paymentRequests").where("status", "==", "pending").get(),
  ]);

  const owners = ownersSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
  const parkings = parkingsSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
  const operators = operatorsSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
  const sessions = sessionsSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
  const allPayments = paymentsSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));

  const ownerNameById = {};
  owners.forEach((owner) => {
    ownerNameById[owner.ownerId || owner.id] = owner.fullName || owner.email || owner.ownerId || owner.id;
  });
  const parkingNameById = {};
  parkings.forEach((parking) => {
    parkingNameById[parking.id] = parking.name || parking.id;
  });

  const filteredPayments = allPayments.filter((payment) => {
    const paidAtMs = parseTimestampMs(payment.paidAt || payment.createdAt || payment.updatedAt);
    return paidAtMs && paidAtMs >= range.fromMs && paidAtMs <= range.toMs;
  });

  let totalGrossRevenue = 0;
  let totalOwnerRevenue = 0;
  let totalAdminCommission = 0;
  const methodMap = {};
  const ownersAgg = {};
  const parkingsAgg = {};
  const seriesMap = buildSeriesSkeleton(range.fromMs, range.toMs);

  const paymentsTable = filteredPayments
    .map((payment) => {
      const split = normalizeSplit(payment.grossAmount, payment.ownerAmount, payment.platformCommission);
      const paidAtMs = parseTimestampMs(payment.paidAt || payment.createdAt || payment.updatedAt);
      const method = String(payment.method || "unknown").toLowerCase();

      totalGrossRevenue += split.grossAmount;
      totalOwnerRevenue += split.ownerAmount;
      totalAdminCommission += split.adminCommissionDerived;

      if (!methodMap[method]) methodMap[method] = { method, amount: 0, count: 0 };
      methodMap[method].amount += split.grossAmount;
      methodMap[method].count += 1;

      const ownerId = String(payment.ownerId || "unknown");
      if (!ownersAgg[ownerId]) {
        ownersAgg[ownerId] = {
          ownerId,
          ownerName: ownerNameById[ownerId] || ownerId,
          grossAmount: 0,
          ownerAmount: 0,
          adminCommission: 0,
          paymentsCount: 0,
        };
      }
      ownersAgg[ownerId].grossAmount += split.grossAmount;
      ownersAgg[ownerId].ownerAmount += split.ownerAmount;
      ownersAgg[ownerId].adminCommission += split.adminCommissionDerived;
      ownersAgg[ownerId].paymentsCount += 1;

      const parkingId = String(payment.parkingId || "unknown");
      if (!parkingsAgg[parkingId]) {
        parkingsAgg[parkingId] = {
          parkingId,
          parkingName: parkingNameById[parkingId] || parkingId,
          grossAmount: 0,
          ownerAmount: 0,
          adminCommission: 0,
          paymentsCount: 0,
        };
      }
      parkingsAgg[parkingId].grossAmount += split.grossAmount;
      parkingsAgg[parkingId].ownerAmount += split.ownerAmount;
      parkingsAgg[parkingId].adminCommission += split.adminCommissionDerived;
      parkingsAgg[parkingId].paymentsCount += 1;

      if (paidAtMs) {
        const key = dayKey(paidAtMs);
        if (seriesMap[key]) {
          seriesMap[key].grossAmount += split.grossAmount;
          seriesMap[key].ownerAmount += split.ownerAmount;
          seriesMap[key].adminCommission += split.adminCommissionDerived;
          seriesMap[key].paymentsCount += 1;
        }
      }

      return {
        paymentId: payment.id,
        parkingId: payment.parkingId || "",
        parkingName: parkingNameById[payment.parkingId] || payment.parkingId || "unknown",
        ownerId: payment.ownerId || "",
        ownerName: ownerNameById[payment.ownerId] || payment.ownerId || "unknown",
        grossAmount: split.grossAmount,
        ownerAmount: split.ownerAmount,
        adminCommission: split.adminCommissionDerived,
        method,
        paidAtMs: paidAtMs || 0,
      };
    })
    .sort((a, b) => b.paidAtMs - a.paidAtMs)
    .slice(0, 150);

  return {
    range,
    summary: {
      owners: owners.length,
      operators: operators.length,
      parkings: parkings.length,
      activeParkings: parkings.filter((parking) => parking.status === "active").length,
      totalConfirmedPayments: filteredPayments.length,
      totalCompletedSessions: sessions.length,
      pendingPaymentRequests: pendingRequestsSnap.size,
      totalGrossRevenue: roundMoney(totalGrossRevenue),
      totalOwnerRevenue: roundMoney(totalOwnerRevenue),
      totalAdminCommission: roundMoney(totalAdminCommission),
    },
    revenueSeries: Object.values(seriesMap).sort((a, b) => a.key.localeCompare(b.key)),
    paymentMethodBreakdown: Object.values(methodMap).sort((a, b) => b.amount - a.amount),
    topOwners: Object.values(ownersAgg).sort((a, b) => b.grossAmount - a.grossAmount).slice(0, 10),
    topParkings: Object.values(parkingsAgg).sort((a, b) => b.grossAmount - a.grossAmount).slice(0, 10),
    paymentsTable,
  };
});

exports.getOwnerAnalytics = onCall(CALLABLE_OPTIONS, async (request) => {
  const ownerProfile = await requireRole(request, "owner");
  const ownerId = String(ownerProfile.ownerId || "").trim();
  if (!ownerId) throw new HttpsError("failed-precondition", "Owner profile is missing ownerId.");
  const range = parseAnalyticsRange(request.data || {});

  const [ownerSnap, parkingsSnap, operatorsSnap, sessionsSnap, paymentsSnap, pendingRequestsSnap] = await Promise.all([
    db.collection("owners").doc(ownerId).get(),
    db.collection("parkings").where("ownerId", "==", ownerId).get(),
    db.collection("users").where("ownerId", "==", ownerId).where("role", "==", "operator").get(),
    db.collection("sessions").where("ownerId", "==", ownerId).get(),
    db.collection("payments").where("ownerId", "==", ownerId).where("status", "==", "confirmed").get(),
    db.collection("paymentRequests").where("ownerId", "==", ownerId).where("status", "==", "pending").get(),
  ]);

  const ownerAccount = ownerSnap.exists ? ownerSnap.data() : {};
  const parkings = parkingsSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
  const operators = operatorsSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
  const sessions = sessionsSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
  const allPayments = paymentsSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));

  const parkingNameById = {};
  parkings.forEach((parking) => {
    parkingNameById[parking.id] = parking.name || parking.id;
  });

  const filteredPayments = allPayments.filter((payment) => {
    const paidAtMs = parseTimestampMs(payment.paidAt || payment.createdAt || payment.updatedAt);
    return paidAtMs && paidAtMs >= range.fromMs && paidAtMs <= range.toMs;
  });

  const filteredCompletedSessions = sessions.filter((session) => {
    if (session.status !== "completed") return false;
    const exitMs = parseTimestampMs(session.exitTime || session.updatedAt || session.createdAt);
    return exitMs && exitMs >= range.fromMs && exitMs <= range.toMs;
  });

  let totalGrossRevenue = 0;
  let totalOwnerRevenue = 0;
  let totalAdminCommission = 0;
  const methodMap = {};
  const parkingAgg = {};
  const seriesMap = buildSeriesSkeleton(range.fromMs, range.toMs);

  const paymentsTable = filteredPayments
    .map((payment) => {
      const split = normalizeSplit(payment.grossAmount, payment.ownerAmount, payment.platformCommission);
      const paidAtMs = parseTimestampMs(payment.paidAt || payment.createdAt || payment.updatedAt);
      const method = String(payment.method || "unknown").toLowerCase();

      totalGrossRevenue += split.grossAmount;
      totalOwnerRevenue += split.ownerAmount;
      totalAdminCommission += split.adminCommissionDerived;

      if (!methodMap[method]) methodMap[method] = { method, amount: 0, count: 0 };
      methodMap[method].amount += split.grossAmount;
      methodMap[method].count += 1;

      const parkingId = String(payment.parkingId || "unknown");
      if (!parkingAgg[parkingId]) {
        parkingAgg[parkingId] = {
          parkingId,
          parkingName: parkingNameById[parkingId] || parkingId,
          grossAmount: 0,
          ownerAmount: 0,
          adminCommission: 0,
          paymentsCount: 0,
          sessionsCount: 0,
        };
      }
      parkingAgg[parkingId].grossAmount += split.grossAmount;
      parkingAgg[parkingId].ownerAmount += split.ownerAmount;
      parkingAgg[parkingId].adminCommission += split.adminCommissionDerived;
      parkingAgg[parkingId].paymentsCount += 1;

      if (paidAtMs) {
        const key = dayKey(paidAtMs);
        if (seriesMap[key]) {
          seriesMap[key].grossAmount += split.grossAmount;
          seriesMap[key].ownerAmount += split.ownerAmount;
          seriesMap[key].adminCommission += split.adminCommissionDerived;
          seriesMap[key].paymentsCount += 1;
        }
      }

      return {
        paymentId: payment.id,
        parkingId: payment.parkingId || "",
        parkingName: parkingNameById[payment.parkingId] || payment.parkingId || "unknown",
        grossAmount: split.grossAmount,
        ownerAmount: split.ownerAmount,
        adminCommission: split.adminCommissionDerived,
        method,
        paidAtMs: paidAtMs || 0,
      };
    })
    .sort((a, b) => b.paidAtMs - a.paidAtMs)
    .slice(0, 150);

  filteredCompletedSessions.forEach((session) => {
    const parkingId = String(session.parkingId || "unknown");
    if (!parkingAgg[parkingId]) {
      parkingAgg[parkingId] = {
        parkingId,
        parkingName: parkingNameById[parkingId] || parkingId,
        grossAmount: 0,
        ownerAmount: 0,
        adminCommission: 0,
        paymentsCount: 0,
        sessionsCount: 0,
      };
    }
    parkingAgg[parkingId].sessionsCount += 1;
  });

  const totalCapacity = parkings.reduce((acc, parking) => acc + toNumber(parking.slotCapacity, 0), 0);
  const totalAvailable = parkings.reduce((acc, parking) => acc + toNumber(parking.availableSlots, 0), 0);
  const totalReserved = parkings.reduce((acc, parking) => acc + toNumber(parking.reservedSlots, 0), 0);
  const totalOccupied = parkings.reduce((acc, parking) => acc + toNumber(parking.occupiedSlots, 0), 0);

  return {
    ownerId,
    ownerAccount: {
      ownerId,
      fullName: ownerAccount.fullName || ownerProfile.fullName || "",
      email: ownerAccount.email || ownerProfile.email || "",
      phone: ownerAccount.phone || ownerProfile.phone || "",
      bankAccountNumber: ownerAccount.bankAccountNumber || "",
    },
    range,
    summary: {
      ownedParkings: parkings.length,
      activeOperators: operators.filter((operator) => operator.status === "active").length,
      inactiveOperators: operators.filter((operator) => operator.status !== "active").length,
      totalCapacity,
      totalAvailable,
      totalReserved,
      totalOccupied,
      pendingPaymentRequests: pendingRequestsSnap.size,
      totalCompletedSessions: filteredCompletedSessions.length,
      totalGrossRevenue: roundMoney(totalGrossRevenue),
      totalOwnerRevenue: roundMoney(totalOwnerRevenue),
      totalAdminCommission: roundMoney(totalAdminCommission),
    },
    revenueSeries: Object.values(seriesMap).sort((a, b) => a.key.localeCompare(b.key)),
    paymentMethodBreakdown: Object.values(methodMap).sort((a, b) => b.amount - a.amount),
    parkingsTable: Object.values(parkingAgg).sort((a, b) => b.grossAmount - a.grossAmount).slice(0, 30),
    paymentsTable,
    operators: operators.map((operator) => ({
      id: operator.id,
      fullName: operator.fullName || "",
      email: operator.email || "",
      status: operator.status || "inactive",
      assignedParkingIds: Array.isArray(operator.assignedParkingIds) ? operator.assignedParkingIds : [],
    })),
    parkings: parkings.map((parking) => ({
      id: parking.id,
      name: parking.name || parking.id,
      address: parking.address || "",
      status: parking.status || "inactive",
      slotCapacity: toNumber(parking.slotCapacity, 0),
      availableSlots: toNumber(parking.availableSlots, 0),
      reservedSlots: toNumber(parking.reservedSlots, 0),
      occupiedSlots: toNumber(parking.occupiedSlots, 0),
      hourlyRate: toNumber(parking.hourlyRate, FLAT_HOURLY_RATE),
    })),
  };
});

exports.createOwnerAccount = onCall(CALLABLE_OPTIONS, async (request) => {
  const actorUid = request.auth?.uid;
  await requireRole(request, "admin");

  const fullName = String(request.data?.fullName || "").trim();
  const email = normalizeEmail(request.data?.email);
  const password = String(request.data?.password || "").trim();
  const phone = String(request.data?.phone || "").trim();
  const bankAccountNumber = String(request.data?.bankAccountNumber || "").trim();

  if (!fullName || !email || !password) {
    throw new HttpsError("invalid-argument", "fullName, email, and password are required.");
  }
  if (password.length < 6) {
    throw new HttpsError("invalid-argument", "Password must be at least 6 characters.");
  }

  let ownerAuthUser = null;
  try {
    ownerAuthUser = await admin.auth().createUser({
      email,
      password,
      displayName: fullName,
    });
  } catch (error) {
    if (error.code === "auth/email-already-exists") {
      throw new HttpsError("already-exists", "Email is already in use.");
    }
    throw new HttpsError("internal", "Failed to create owner auth account.");
  }

  const ownerUid = ownerAuthUser.uid;
  const ownerId = `owner_${ownerUid}`;
  const ownerRef = db.collection("owners").doc(ownerId);
  const userRef = db.collection("users").doc(ownerUid);
  const now = nowMs();

  await db.runTransaction(async (tx) => {
    tx.set(
      userRef,
      {
        fullName,
        email,
        phone,
        role: "owner",
        status: "active",
        ownerId,
        assignedParkingIds: [],
        createdAt: now,
        updatedAt: now,
      },
      { merge: true }
    );

    tx.set(
      ownerRef,
      {
        ownerId,
        userId: ownerUid,
        fullName,
        email,
        phone,
        bankAccountNumber,
        status: "active",
        createdAt: ts(now),
        updatedAt: ts(now),
      },
      { merge: true }
    );
  });

  await writeAuditLog("CREATE_OWNER_ACCOUNT", actorUid, null, { ownerId, ownerUid, email });
  return { ownerId, userId: ownerUid, email };
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
      paymentStatus: "unpaid",
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

exports.ownerUpdatePaymentDetails = onCall(CALLABLE_OPTIONS, async (request) => {
  const actorUid = request.auth?.uid;
  const ownerProfile = await requireRole(request, "owner");
  const ownerId = String(ownerProfile.ownerId || "").trim();
  if (!ownerId) throw new HttpsError("failed-precondition", "Owner profile is missing ownerId.");

  const phone = String(request.data?.phone || "").trim();
  const bankAccountNumber = String(request.data?.bankAccountNumber || "").trim();
  if (!phone && !bankAccountNumber) {
    throw new HttpsError("invalid-argument", "At least one of phone or bankAccountNumber is required.");
  }

  const ownerRef = db.collection("owners").doc(ownerId);
  const userRef = db.collection("users").doc(actorUid);
  const now = nowMs();

  await db.runTransaction(async (tx) => {
    const ownerSnap = await tx.get(ownerRef);
    if (!ownerSnap.exists) throw new HttpsError("not-found", "Owner profile document not found.");

    const updatePayload = {
      updatedAt: ts(now),
    };
    if (request.data?.phone !== undefined) updatePayload.phone = phone;
    if (request.data?.bankAccountNumber !== undefined) updatePayload.bankAccountNumber = bankAccountNumber;

    tx.set(ownerRef, updatePayload, { merge: true });
    if (request.data?.phone !== undefined) {
      tx.set(userRef, { phone, updatedAt: Date.now() }, { merge: true });
    }
  });

  await writeAuditLog("OWNER_UPDATE_PAYMENT_DETAILS", actorUid, null, {
    ownerId,
    updatedPhone: request.data?.phone !== undefined,
    updatedBankAccountNumber: request.data?.bankAccountNumber !== undefined,
  });

  return {
    ownerId,
    phone: request.data?.phone !== undefined ? phone : null,
    bankAccountNumber: request.data?.bankAccountNumber !== undefined ? bankAccountNumber : null,
    updatedAtMs: now,
  };
});

exports.getParkingPaymentDetails = onCall(CALLABLE_OPTIONS, async (request) => {
  if (!request.auth?.uid) {
    throw new HttpsError("unauthenticated", "Authentication required.");
  }

  const parkingId = String(request.data?.parkingId || "").trim();
  if (!parkingId) {
    throw new HttpsError("invalid-argument", "parkingId is required.");
  }

  const profile = await getUserProfile(request.auth.uid);
  if (!profile) {
    throw new HttpsError("failed-precondition", "User profile not found.");
  }
  if (profile.status && profile.status !== "active") {
    throw new HttpsError("permission-denied", "User is not active.");
  }

  const allowedRoles = ["driver", "operator", "owner", "admin"];
  if (!allowedRoles.includes(profile.role)) {
    throw new HttpsError("permission-denied", "Role not allowed.");
  }

  const parkingSnap = await db.collection("parkings").doc(parkingId).get();
  if (!parkingSnap.exists) {
    throw new HttpsError("not-found", "Parking not found.");
  }
  const parking = parkingSnap.data();
  const ownerId = String(parking.ownerId || "").trim();
  if (!ownerId) {
    return { parkingId, ownerId: null, phone: "", bankAccountNumber: "" };
  }

  const ownerSnap = await db.collection("owners").doc(ownerId).get();
  const owner = ownerSnap.exists ? ownerSnap.data() : {};

  return {
    parkingId,
    ownerId,
    phone: String(owner.phone || "").trim(),
    bankAccountNumber: String(owner.bankAccountNumber || "").trim(),
  };
});
