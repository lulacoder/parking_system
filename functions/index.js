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
function nowMs() {
  return Date.now();
}

function timestampFromMs(ms) {
  return Timestamp.fromMillis(ms);
}

function normalizePlate(plateNumber) {
  return String(plateNumber || "").trim().toUpperCase().replace(/\s+/g, " ");
}

function parseTimestampMs(value) {
  if (!value) return null;
  if (typeof value === "number") return value;
  if (value.toMillis) return value.toMillis();
  if (value.seconds) return value.seconds * 1000;
  return null;
}

function ensureParkingInvariant(parking) {
  const available = Number(parking.availableSlots || 0);
  const reserved = Number(parking.reservedSlots || 0);
  const occupied = Number(parking.occupiedSlots || 0);
  const capacity = Number(parking.slotCapacity || 0);
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
  if (!profile) {
    throw new HttpsError("failed-precondition", "User profile not found.");
  }
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
    createdAt: timestampFromMs(nowMs()),
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
  const createdAtMs = nowMs();
  const expiresAtMs = createdAtMs + BOOKING_TTL_MINUTES * 60 * 1000;

  await db.runTransaction(async (tx) => {
    const parkingSnap = await tx.get(parkingRef);
    if (!parkingSnap.exists) throw new HttpsError("not-found", "Parking not found.");
    const parking = parkingSnap.data();

    if (parking.status !== "active") throw new HttpsError("failed-precondition", "Parking is not active.");
    if ((parking.availableSlots || 0) <= 0) throw new HttpsError("resource-exhausted", "No available slots.");
    if (!ensureParkingInvariant(parking)) throw new HttpsError("failed-precondition", "Parking counters invalid.");

    tx.set(bookingRef, {
      parkingId,
      driverId: actorUid,
      driverEmail: profile.email || "",
      plateNumber,
      status: "reserved",
      reservedAt: timestampFromMs(createdAtMs),
      expiresAt: timestampFromMs(expiresAtMs),
      checkInAt: null,
      checkOutAt: null,
      createdAt: timestampFromMs(createdAtMs),
      updatedAt: timestampFromMs(createdAtMs),
    });

    tx.update(parkingRef, {
      availableSlots: FieldValue.increment(-1),
      reservedSlots: FieldValue.increment(1),
      updatedAt: timestampFromMs(createdAtMs),
    });
  });

  await writeAuditLog("CREATE_BOOKING", actorUid, parkingId, { bookingId: bookingRef.id, plateNumber });
  return {
    bookingId: bookingRef.id,
    status: "reserved",
    expiresAt: expiresAtMs,
  };
});

exports.expireBookings = onSchedule(
  { region: REGION, schedule: "every 5 minutes", timeZone: "Africa/Nairobi" },
  async () => {
    const now = timestampFromMs(nowMs());
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
        if (!freshBooking.exists) return;
        const freshData = freshBooking.data();
        if (freshData.status !== "reserved") return;

        const parkingSnap = await tx.get(parkingRef);
        if (!parkingSnap.exists) return;

        tx.update(bookingRef, {
          status: "expired",
          updatedAt: timestampFromMs(nowMs()),
        });
        tx.update(parkingRef, {
          reservedSlots: FieldValue.increment(-1),
          availableSlots: FieldValue.increment(1),
          updatedAt: timestampFromMs(nowMs()),
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
  let bookingExpired = false;
  if (bookingDoc) {
    const expiresAt = parseTimestampMs(bookingDoc.data().expiresAt);
    bookingExpired = !!expiresAt && expiresAt < now;
  }

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
      const bookingSnap = await tx.get(bookingRef);
      if (bookingSnap.exists && bookingSnap.data().status === "reserved") {
        const booking = bookingSnap.data();
        bookingId = bookingRef.id;
        driverId = booking.driverId || null;
        tx.update(bookingRef, {
          status: "checked_in",
          checkInAt: timestampFromMs(now),
          updatedAt: timestampFromMs(now),
        });
        tx.update(parkingRef, {
          reservedSlots: FieldValue.increment(-1),
          occupiedSlots: FieldValue.increment(1),
          updatedAt: timestampFromMs(now),
        });
      }
    } else if (bookingDoc && bookingExpired) {
      const bookingRef = bookingDoc.ref;
      tx.update(bookingRef, { status: "expired", updatedAt: timestampFromMs(now) });
      tx.update(parkingRef, {
        reservedSlots: FieldValue.increment(-1),
        availableSlots: FieldValue.increment(1),
        updatedAt: timestampFromMs(now),
      });
    }

    if (!bookingId) {
      if (!allowWalkIn) {
        throw new HttpsError("failed-precondition", "No active reservation. Enable walk-in to proceed.");
      }
      if ((parking.availableSlots || 0) <= 0) {
        throw new HttpsError("resource-exhausted", "No available slots for walk-in.");
      }
      tx.update(parkingRef, {
        availableSlots: FieldValue.increment(-1),
        occupiedSlots: FieldValue.increment(1),
        updatedAt: timestampFromMs(now),
      });
    }

    tx.set(sessionRef, {
      parkingId,
      bookingId,
      driverId,
      plateNumber,
      entryTime: timestampFromMs(now),
      exitTime: null,
      durationMinutes: null,
      billedHours: null,
      hourlyRate: Number(parking.hourlyRate || 50),
      feeAmount: null,
      status: "active",
      checkedInBy: actorUid,
      checkedOutBy: null,
      createdAt: timestampFromMs(now),
      updatedAt: timestampFromMs(now),
    });
  });

  await writeAuditLog("CHECK_IN_VEHICLE", actorUid, parkingId, {
    plateNumber,
    sessionId: sessionRef.id,
  });

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
  const now = nowMs();
  let responsePayload = null;

  await db.runTransaction(async (tx) => {
    const sessionSnap = await tx.get(sessionRef);
    if (!sessionSnap.exists) throw new HttpsError("not-found", "Session not found.");
    const session = sessionSnap.data();
    if (session.status !== "active") throw new HttpsError("failed-precondition", "Session already completed.");

    const parkingSnap = await tx.get(parkingRef);
    if (!parkingSnap.exists) throw new HttpsError("not-found", "Parking not found.");
    const parking = parkingSnap.data();

    const entryMs = parseTimestampMs(session.entryTime);
    const durationMinutes = Math.max(1, Math.ceil((now - entryMs) / 60000));
    const billedHours = Math.max(1, Math.ceil(durationMinutes / 60));
    const hourlyRate = Number(session.hourlyRate || parking.hourlyRate || 50);
    const feeAmount = billedHours * hourlyRate;

    tx.update(sessionRef, {
      status: "completed",
      exitTime: timestampFromMs(now),
      durationMinutes,
      billedHours,
      feeAmount,
      checkedOutBy: actorUid,
      updatedAt: timestampFromMs(now),
    });

    tx.update(parkingRef, {
      occupiedSlots: FieldValue.increment(-1),
      availableSlots: FieldValue.increment(1),
      updatedAt: timestampFromMs(now),
    });

    if (session.bookingId) {
      const bookingRef = db.collection("bookings").doc(session.bookingId);
      tx.set(
        bookingRef,
        {
          status: "completed",
          checkOutAt: timestampFromMs(now),
          updatedAt: timestampFromMs(now),
        },
        { merge: true }
      );
    }

    responsePayload = {
      sessionId: sessionRef.id,
      status: "completed",
      durationMinutes,
      billedHours,
      feeAmount,
    };
  });

  await writeAuditLog("CHECK_OUT_VEHICLE", actorUid, parkingId, {
    plateNumber,
    sessionId: sessionRef.id,
    feeAmount: responsePayload.feeAmount,
  });

  return responsePayload;
});
