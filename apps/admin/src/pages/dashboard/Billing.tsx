import React from "react";
import { useLocation } from "wouter";
import { useGetMe, useGetOrgSubscriptions, useGetApps, useCreatePortalSession } from "@workspace/api-client-react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CreditCard, ExternalLink, CheckCircle2, AlertCircle } from "lucide-react";

const STATUS_CONFIG: Record<string, { color: string; label: string }> = {
  active: { color: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200", label: "Active" },
  trialing: { color: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200", label: "Trial" },
  past_due: { color: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200", label: "Past Due" },
  canceled: { color: "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200", label: "Canceled" },
  incomplete: { color: "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200", label: "Incomplete" },
};

export default function Billing() {
  const [, setLocation] = useLocation();
  const { data: user, isLoading: userLoading } = useGetMe({ query: { retry: false } });
  const orgId = user?.activeOrgId ?? "";
  const { data: subscriptions, isLoading } = useGetOrgSubscriptions(orgId, { query: { enabled: !!orgId } });
  const { data: apps } = useGetApps();
  const createPortal = useCreatePortalSession();

  React.useEffect(() => {
    if (!userLoading && !user) setLocation("/login");
  }, [user, userLoading, setLocation]);

  const handleManageBilling = async () => {
    try {
      const result = await createPortal.mutateAsync({ data: { orgId } });
      if (result.url) window.location.href = result.url;
    } catch {
      alert("Could not open billing portal. Please ensure your Stripe account is configured.");
    }
  };

  const activeSubAppIds = new Set(subscriptions?.map((s) => s.appId) ?? []);

  return (
    <AppLayout>
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <CreditCard className="w-6 h-6 text-primary" />
            <div>
              <h1 className="text-2xl font-bold">Billing & Subscriptions</h1>
              <p className="text-muted-foreground text-sm">Manage your subscriptions and billing</p>
            </div>
          </div>
          <Button variant="outline" onClick={handleManageBilling} disabled={createPortal.isPending}>
            <ExternalLink className="w-4 h-4 mr-2" />
            Manage Billing
          </Button>
        </div>

        {/* Current Subscriptions */}
        <Card>
          <CardHeader>
            <CardTitle>Active Subscriptions</CardTitle>
            <CardDescription>Your organization's current app subscriptions</CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="text-center py-8 text-muted-foreground">Loading subscriptions...</div>
            ) : subscriptions?.length === 0 ? (
              <div className="text-center py-8">
                <AlertCircle className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
                <p className="text-muted-foreground">No active subscriptions</p>
                <p className="text-sm text-muted-foreground mt-1">Subscribe to an app below to get started</p>
              </div>
            ) : (
              <div className="space-y-3">
                {subscriptions?.map((sub) => {
                  const cfg = STATUS_CONFIG[sub.status] ?? STATUS_CONFIG.active;
                  return (
                    <div key={sub.id} className="flex items-center justify-between p-4 rounded-lg border bg-card">
                      <div className="flex items-center gap-3">
                        <CheckCircle2 className="w-5 h-5 text-green-500" />
                        <div>
                          <div className="font-medium">{sub.appName}</div>
                          <div className="text-sm text-muted-foreground">{sub.planName} plan</div>
                        </div>
                      </div>
                      <div className="flex items-center gap-4">
                        {sub.currentPeriodEnd && (
                          <span className="text-sm text-muted-foreground">
                            Renews {new Date(sub.currentPeriodEnd).toLocaleDateString()}
                          </span>
                        )}
                        <Badge className={`text-xs ${cfg.color}`}>{cfg.label}</Badge>
                        {sub.cancelAtPeriodEnd && (
                          <Badge variant="destructive" className="text-xs">Canceling</Badge>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Available Apps */}
        <Card>
          <CardHeader>
            <CardTitle>Available Applications</CardTitle>
            <CardDescription>Subscribe to additional apps for your organization</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {apps?.filter((app) => !activeSubAppIds.has(app.id)).map((app) => (
                <div key={app.id} className="p-4 rounded-lg border bg-card">
                  <div className="font-medium mb-1">{app.name}</div>
                  <p className="text-sm text-muted-foreground mb-3">{app.description}</p>
                  <div className="space-y-2">
                    {app.plans?.map((plan) => (
                      <div key={plan.id} className="flex items-center justify-between">
                        <div>
                          <span className="text-sm font-medium">{plan.name}</span>
                          <span className="text-sm text-muted-foreground ml-2">
                            ${(plan.priceMonthly / 100).toFixed(0)}/mo
                          </span>
                        </div>
                        <Button size="sm" variant="outline" onClick={() => {
                          alert(`To subscribe, configure Stripe and set the price ID for the ${plan.name} plan.`);
                        }}>
                          Subscribe
                        </Button>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
              {apps?.filter((app) => !activeSubAppIds.has(app.id)).length === 0 && (
                <div className="col-span-2 text-center py-8 text-muted-foreground">
                  You are subscribed to all available applications
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}
