import React from "react";
import { Navigate, Outlet } from "react-router-dom";
import { getRoleHome, sanitizeRole } from "./roleUtils";

export function RequireAuth({ user, loading }) {
  if (loading) return null;
  if (!user) return <Navigate to="/login" replace />;
  return <Outlet />;
}

export function RequireRole({ user, role, allowedRoles }) {
  if (!user) return <Navigate to="/login" replace />;
  if (!allowedRoles.includes(role)) {
    return <Navigate to={getRoleHome(role)} replace />;
  }
  return <Outlet />;
}

export function RedirectHome({ user, role, loading }) {
  if (loading) return null;
  if (!user) return <Navigate to="/login" replace />;
  return <Navigate to={getRoleHome(sanitizeRole(role))} replace />;
}
