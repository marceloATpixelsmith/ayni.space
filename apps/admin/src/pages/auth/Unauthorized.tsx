import React from "react";
import { useLocation } from "wouter";
import { useAuth } from "@workspace/frontend-security";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

export default function Unauthorized() {
  const [, setLocation] = useLocation();
  const auth = useAuth();

  React.useEffect(() => {
    if (auth.status === "unauthenticated") {
      setLocation("/login");
    }
  }, [auth.status, setLocation]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-6">
      <Card className="max-w-lg w-full p-8 space-y-4">
        <h1 className="text-2xl font-bold">Access restricted</h1>
        <p className="text-muted-foreground">
          Your account is authenticated but does not have super-admin privileges for this application.
        </p>
        <div className="flex gap-3">
          <Button variant="outline" onClick={() => setLocation("/login")}>Back to login</Button>
          {auth.status === "authenticated" && (
            <Button
              onClick={() => {
                auth.logout().then(() => setLocation("/login"));
              }}
            >
              Logout
            </Button>
          )}
        </div>
      </Card>
    </div>
  );
}
