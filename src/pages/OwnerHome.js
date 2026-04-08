import React, { useEffect, useMemo, useState } from "react";
import { auth, firestore } from "../firebase";

function OwnerHome() {
  const [ownerProfile, setOwnerProfile] = useState(null);
  const [parkings, setParkings] = useState([]);
  const [completedSessions, setCompletedSessions] = useState([]);
  const [payments, setPayments] = useState([]);
  const [error, setError] = useState("");

  useEffect(() => {
    const uid = auth.currentUser?.uid;
    if (!uid) return undefined;
    const unsub = firestore.collection("users").doc(uid).onSnapshot(
      (snap) => setOwnerProfile(snap.exists ? snap.data() : null),
      (err) => setError(err.message)
    );
    return () => unsub();
  }, []);

  useEffect(() => {
    if (!ownerProfile?.ownerId) {
      setParkings([]);
      return undefined;
    }
    const unsub = firestore
      .collection("parkings")
      .where("ownerId", "==", ownerProfile.ownerId)
      .onSnapshot(
        (snap) => setParkings(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
        (err) => setError(err.message)
      );
    return () => unsub();
  }, [ownerProfile]);

  useEffect(() => {
    if (!parkings.length) {
      setCompletedSessions([]);
      setPayments([]);
      return undefined;
    }
    let mounted = true;
    const sessionUnsubs = parkings.map((p) =>
      firestore
        .collection("sessions")
        .where("parkingId", "==", p.id)
        .where("status", "==", "completed")
        .onSnapshot((snap) => {
          if (!mounted) return;
          const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
          setCompletedSessions((prev) => {
            const rest = prev.filter((x) => x.parkingId !== p.id);
            return [...rest, ...rows];
          });
        })
    );
    const paymentUnsubs = parkings.map((p) =>
      firestore
        .collection("payments")
        .where("parkingId", "==", p.id)
        .where("status", "==", "confirmed")
        .onSnapshot((snap) => {
          if (!mounted) return;
          const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
          setPayments((prev) => {
            const rest = prev.filter((x) => x.parkingId !== p.id);
            return [...rest, ...rows];
          });
        })
    );
    return () => {
      mounted = false;
      sessionUnsubs.forEach((fn) => fn());
      paymentUnsubs.forEach((fn) => fn());
    };
  }, [parkings]);

  const summary = useMemo(() => {
    const totalCapacity = parkings.reduce((acc, p) => acc + Number(p.slotCapacity || 0), 0);
    const totalAvailable = parkings.reduce((acc, p) => acc + Number(p.availableSlots || 0), 0);
    const totalReserved = parkings.reduce((acc, p) => acc + Number(p.reservedSlots || 0), 0);
    const totalOccupied = parkings.reduce((acc, p) => acc + Number(p.occupiedSlots || 0), 0);
    const totalOwnerRevenue = payments.reduce((acc, p) => acc + Number(p.ownerAmount || 0), 0);
    const totalGrossRevenue = payments.reduce((acc, p) => acc + Number(p.grossAmount || 0), 0);
    const totalSessions = completedSessions.length;

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const sevenDaysAgo = new Date(today);
    sevenDaysAgo.setDate(today.getDate() - 6);
    const todayMs = today.getTime();
    const weekMs = sevenDaysAgo.getTime();

    const todaySessions = completedSessions.filter((s) => getMs(s.exitTime || s.updatedAt) >= todayMs).length;
    const weekSessions = completedSessions.filter((s) => getMs(s.exitTime || s.updatedAt) >= weekMs).length;

    return {
      totalCapacity,
      totalAvailable,
      totalReserved,
      totalOccupied,
      totalOwnerRevenue,
      totalGrossRevenue,
      totalSessions,
      todaySessions,
      weekSessions,
    };
  }, [completedSessions, parkings, payments]);

  return (
    <div className="container py-4">
      <div className="card border-0 shadow-sm mb-4">
        <div className="card-body">
          <h3 className="fw-bold mb-2">Owner Dashboard</h3>
          <p className="text-muted mb-0">
            Live utilization and revenue from completed sessions/payments across owned parking locations.
          </p>
        </div>
      </div>

      {error && <div className="alert alert-danger">{error}</div>}

      <div className="row g-3 mb-4">
        <StatCard title="Owned Parkings" value={parkings.length} />
        <StatCard title="Total Capacity" value={summary.totalCapacity} />
        <StatCard title="Available" value={summary.totalAvailable} />
        <StatCard title="Occupied" value={summary.totalOccupied} />
        <StatCard title="Reserved" value={summary.totalReserved} />
        <StatCard title="Completed Sessions (All)" value={summary.totalSessions} />
        <StatCard title="Completed Sessions (Today)" value={summary.todaySessions} />
        <StatCard title="Completed Sessions (7 days)" value={summary.weekSessions} />
        <StatCard title="Gross Revenue" value={`${summary.totalGrossRevenue.toFixed(2)} ETB`} />
        <StatCard title="Owner Revenue" value={`${summary.totalOwnerRevenue.toFixed(2)} ETB`} />
      </div>

      <div className="row g-4">
        <div className="col-lg-6">
          <div className="card border-0 shadow-sm h-100">
            <div className="card-body">
              <h5 className="fw-bold mb-3">Owned Parkings</h5>
              {!parkings.length ? (
                <div className="text-muted">No parking sites assigned to this owner yet.</div>
              ) : (
                <div className="list-group">
                  {parkings.map((p) => (
                    <div key={p.id} className="list-group-item">
                      <div className="fw-bold">{p.name}</div>
                      <div className="small text-muted">{p.address || "No address"}</div>
                      <div className="small">Available {p.availableSlots || 0} / Capacity {p.slotCapacity || 0}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="col-lg-6">
          <div className="card border-0 shadow-sm h-100">
            <div className="card-body">
              <h5 className="fw-bold mb-3">Recent Confirmed Payments</h5>
              {!payments.length ? (
                <div className="text-muted">No confirmed payments yet.</div>
              ) : (
                <div className="list-group">
                  {payments
                    .sort((a, b) => getMs(b.paidAt) - getMs(a.paidAt))
                    .slice(0, 10)
                    .map((p) => (
                      <div key={p.id} className="list-group-item">
                        <div className="fw-bold">{Number(p.grossAmount || 0).toFixed(2)} ETB</div>
                        <div className="small text-muted">
                          Owner: {Number(p.ownerAmount || 0).toFixed(2)} | Commission: {Number(p.platformCommission || 0).toFixed(2)}
                        </div>
                        <div className="small text-muted">{formatDate(p.paidAt)}</div>
                      </div>
                    ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function getMs(value) {
  if (!value) return 0;
  if (typeof value === "number") return value;
  if (value.toMillis) return value.toMillis();
  if (value.seconds) return value.seconds * 1000;
  return 0;
}

function formatDate(value) {
  return new Date(getMs(value)).toLocaleString();
}

function StatCard({ title, value }) {
  return (
    <div className="col-6 col-md-4 col-lg-3">
      <div className="card border-0 shadow-sm h-100">
        <div className="card-body">
          <div className="small text-muted">{title}</div>
          <div className="h5 fw-bold mb-0">{value}</div>
        </div>
      </div>
    </div>
  );
}

export default OwnerHome;
