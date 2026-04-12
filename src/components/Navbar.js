import React from "react";
import { LogOut, Shield } from "lucide-react";
import { auth } from "../firebase";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";

const brandLogoUrl = `${process.env.PUBLIC_URL}/logo.svg`;

function Navbar({ userRole, userEmail }) {
  const handleLogout = () => {
    if (window.confirm("Are you sure you want to logout?")) {
      auth.signOut();
    }
  };

  const roleLabel = {
    admin: "Admin",
    owner: "Owner",
    operator: "Operator",
    driver: "Driver",
    user: "Driver",
  };

  return (
    <header className="sticky top-0 z-40 border-b border-border/60 bg-white/90 backdrop-blur">
      <div className="mx-auto flex w-full max-w-[1400px] items-center justify-between px-4 py-3 md:px-6">
        <div className="flex items-center gap-3">
          <img
            src={brandLogoUrl}
            alt="Enderase"
            className="h-12 w-12 rounded-xl bg-white object-cover shadow-soft"
          />
          <div>
            <p className="font-heading text-xl font-bold tracking-wide text-slate-900">ENDERASE</p>
            <p className="text-xs font-medium uppercase tracking-[0.2em] text-slate-500">Smart Parking</p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="hidden items-center gap-3 rounded-xl border border-border bg-card px-3 py-2 md:flex">
            <Shield className="h-4 w-4 text-blue-600" />
            <div className="text-right">
              <p className="text-sm font-medium text-slate-700">{userEmail}</p>
              <Badge variant="default">{roleLabel[userRole] || userRole}</Badge>
            </div>
          </div>

          <Button variant="destructive" size="sm" onClick={handleLogout}>
            <LogOut className="h-4 w-4" />
            Logout
          </Button>
        </div>
      </div>
    </header>
  );
}

export default Navbar;
