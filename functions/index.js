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

async function writeAuditLog(action, actorUid, parkingId, metadata = {}) {
  await db.collection("auditLogs").add({
    action,
    actorUid,
    parkingId: parkingId || null,
    metadata,
    createdAt: ts(),
  });
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
      hourlyRate: toNumber(parking.hourlyRate, 50),
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

    const parkingSnap = await tx.get(parkingRef);
    if (!parkingSnap.exists) throw new HttpsError("not-found", "Parking not found.");

    const entryMs = parseTimestampMs(session.entryTime);
    const durationMinutes = Math.max(1, Math.ceil((now - entryMs) / 60000));
    const billedHours = Math.max(1, Math.ceil(durationMinutes / 60));
    const hourlyRate = toNumber(session.hourlyRate, 50);
    const feeAmount = billedHours * hourlyRate;
    const platformCommission = Math.round(feeAmount * PLATFORM_COMMISSION_RATE * 100) / 100;
    const ownerAmount = Math.round((feeAmount - platformCommission) * 100) / 100;

    tx.update(sessionRef, {
      status: "completed",
      exitTime: ts(now),
      durationMinutes,
      billedHours,
      feeAmount,
      paymentStatus: "confirmed",
      checkedOutBy: actorUid,
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
      method: request.data?.paymentMethod || "manual",
      status: "confirmed",
      paidAt: ts(now),
      confirmedBy: actorUid,
      createdAt: ts(now),
      updatedAt: ts(now),
    });

    result = { sessionId: sessionRef.id, paymentId: paymentRef.id, status: "completed", durationMinutes, billedHours, feeAmount };
  });

  await writeAuditLog("CHECK_OUT_VEHICLE", actorUid, parkingId, {
    plateNumber,
    sessionId: result.sessionId,
    paymentId: result.paymentId,
    feeAmount: result.feeAmount,
  });
  return result;
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
