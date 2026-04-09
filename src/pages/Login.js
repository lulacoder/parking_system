import React, { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { auth } from "../firebase";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";

function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const handleLogin = async (e) => {
    e.preventDefault();
    setLoading(true);

    try {
      await Promise.race([
        auth.signInWithEmailAndPassword(email, password),
        new Promise((_, reject) => setTimeout(() => reject(new Error("LOGIN_TIMEOUT")), 10000)),
      ]);
      toast.success("Welcome back.");
    } catch (error) {
      if (error.message === "LOGIN_TIMEOUT") {
        toast.error("Login timed out. Please check network and retry.");
      } else if (error.code === "auth/wrong-password") {
        toast.error("Incorrect password.");
      } else if (error.code === "auth/user-not-found") {
        toast.error("No account found for this email.");
      } else if (error.code === "auth/invalid-credential") {
        toast.error("Invalid credentials.");
      } else if (error.code === "auth/too-many-requests") {
        toast.error("Too many attempts. Please wait and retry.");
      } else if (error.code === "auth/network-request-failed") {
        toast.error("Network error. Please check your connection.");
      } else {
        toast.error("Login failed. Please try again.");
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mx-auto flex min-h-[82vh] w-full max-w-md items-center">
      <Card className="w-full animate-fade-in-up">
        <CardHeader className="space-y-2 text-center">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-500 to-blue-700 text-3xl text-white shadow-soft">
            🚗
          </div>
          <CardTitle className="text-3xl">Welcome Back</CardTitle>
          <CardDescription>Sign in to manage bookings and operations.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleLogin} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                value={email}
                placeholder="example@mail.com"
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                value={password}
                placeholder="••••••••"
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>

            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {loading ? "Signing in..." : "Sign In"}
            </Button>
          </form>

          <div className="mt-6 text-center text-sm text-muted-foreground">
            No account yet?{" "}
            <button type="button" className="font-semibold text-blue-600 hover:text-blue-700" onClick={() => navigate("/signup")}>
              Create one
            </button>
          </div>
          <div className="mt-2 text-center text-sm text-muted-foreground">
            <Link to="/signup" className="font-semibold text-blue-600 hover:text-blue-700">
              New driver signup
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default Login;
