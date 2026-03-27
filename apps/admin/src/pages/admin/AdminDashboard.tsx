import React from "react";
import { useLocation } from "wouter";
import {
  useGetMe,
  useAdminGetStats,
  useAdminGetOrganizations,
  useAdminGetUsers,
  useAdminGetAuditLogs,
  useAdminGetFeatureFlags,
  useAdminSetFeatureFlag,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Building2, Users, Activity, Flag, LayoutDashboard, LogOut } from "lucide-react";
import { adminAccessDeniedLoginPath } from "../auth/accessDenied";
import { useAuth } from "@workspace/frontend-security";

const NAV = [
  { id: "overview", label: "Overview", icon: LayoutDashboard },
  { id: "organizations", label: "Organizations", icon: Building2 },
  { id: "users", label: "Users", icon: Users },
  { id: "audit-logs", label: "Audit Logs", icon: Activity },
  { id: "feature-flags", label: "Feature Flags", icon: Flag },
];

export default function AdminDashboard({ section = "overview" }: { section?: string }) {
  const [, setLocation] = useLocation();
  const auth = useAuth();

  const { data: user, isLoading: userLoading } = useGetMe();

  React.useEffect(() => {
    if (!userLoading && !user) setLocation("/login");
    if (!userLoading && user && !user.isSuperAdmin) setLocation(adminAccessDeniedLoginPath());
  }, [user, userLoading, setLocation]);

  const handleLogout = async () => {
    await auth.logout();
    setLocation("/login");
  };

  return (
    <div className="min-h-screen flex bg-background">
      {/* Sidebar */}
      <aside className="w-56 bg-sidebar border-r border-sidebar-border flex flex-col">
        <div className="p-4 border-b border-sidebar-border">
          <div className="font-bold text-lg text-sidebar-foreground">Super Admin</div>
          <div className="text-xs text-muted-foreground mt-0.5">{user?.email}</div>
        </div>
        <nav className="flex-1 p-3 space-y-1">
          {NAV.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setLocation(id === "overview" ? "/admin" : `/admin/${id}`)}
              className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-md text-sm transition-colors ${
                section === id
                  ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                  : "text-sidebar-foreground hover:bg-sidebar-accent/50"
              }`}
            >
              <Icon className="w-4 h-4" />
              {label}
            </button>
          ))}
        </nav>
        <div className="p-3 border-t border-sidebar-border">
          <Button variant="ghost" size="sm" className="w-full justify-start" onClick={handleLogout}>
            <LogOut className="w-4 h-4 mr-2" />
            Logout
          </Button>
          <Button variant="ghost" size="sm" className="w-full justify-start mt-1" onClick={() => setLocation("/dashboard")}>
            Back to Overview
          </Button>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-auto p-6">
        {section === "overview" && <AdminOverview />}
        {section === "organizations" && <AdminOrgs />}
        {section === "users" && <AdminUsers />}
        {section === "audit-logs" && <AdminAuditLogs />}
        {section === "feature-flags" && <AdminFeatureFlags />}
      </main>
    </div>
  );
}

function AdminOverview() {
  const { data: stats, isLoading } = useAdminGetStats();
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Platform Overview</h1>
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
        {[
          { label: "Total Users", value: stats?.totalUsers },
          { label: "Organizations", value: stats?.totalOrgs },
          { label: "Total Subscriptions", value: stats?.totalSubscriptions },
          { label: "Active Subscriptions", value: stats?.activeSubscriptions },
          { label: "Apps in Registry", value: stats?.totalApps },
        ].map(({ label, value }) => (
          <Card key={label}>
            <CardContent className="pt-6">
              <div className="text-2xl font-bold">{isLoading ? "..." : value ?? 0}</div>
              <div className="text-xs text-muted-foreground mt-1">{label}</div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

function AdminOrgs() {
  const { data, isLoading } = useAdminGetOrganizations({});
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">All Organizations</h1>
      <Card>
        <CardContent className="pt-4">
          {isLoading ? (
            <div className="text-center py-8 text-muted-foreground">Loading...</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Slug</TableHead>
                  <TableHead>Stripe Customer</TableHead>
                  <TableHead>Created</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data?.organizations.map((org) => (
                  <TableRow key={org.id}>
                    <TableCell className="font-medium">{org.name}</TableCell>
                    <TableCell><Badge variant="secondary" className="font-mono text-xs">{org.slug}</Badge></TableCell>
                    <TableCell className="text-xs text-muted-foreground font-mono">{org.stripeCustomerId ?? "—"}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{new Date(org.createdAt).toLocaleDateString()}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          <div className="text-xs text-muted-foreground mt-3">Total: {data?.total ?? 0}</div>
        </CardContent>
      </Card>
    </div>
  );
}

function AdminUsers() {
  const { data, isLoading } = useAdminGetUsers({});
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">All Users</h1>
      <Card>
        <CardContent className="pt-4">
          {isLoading ? (
            <div className="text-center py-8 text-muted-foreground">Loading...</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Email</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Joined</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data?.users.map((u) => (
                  <TableRow key={u.id}>
                    <TableCell className="font-medium">{u.email}</TableCell>
                    <TableCell className="text-muted-foreground">{u.name ?? "—"}</TableCell>
                    <TableCell>
                      {u.isSuperAdmin && <Badge className="bg-amber-100 text-amber-800 text-xs">Super Admin</Badge>}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">{new Date(u.createdAt).toLocaleDateString()}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          <div className="text-xs text-muted-foreground mt-3">Total: {data?.total ?? 0}</div>
        </CardContent>
      </Card>
    </div>
  );
}

function AdminAuditLogs() {
  const { data, isLoading } = useAdminGetAuditLogs({});
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Audit Logs</h1>
      <Card>
        <CardContent className="pt-4">
          {isLoading ? (
            <div className="text-center py-8 text-muted-foreground">Loading...</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Action</TableHead>
                  <TableHead>User</TableHead>
                  <TableHead>Resource</TableHead>
                  <TableHead>Date</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data?.logs.map((log) => (
                  <TableRow key={log.id}>
                    <TableCell><Badge variant="outline" className="font-mono text-xs">{log.action}</Badge></TableCell>
                    <TableCell className="text-sm text-muted-foreground">{log.userEmail ?? "system"}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{log.resourceType}{log.resourceId ? `:${log.resourceId.slice(0, 8)}` : ""}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{new Date(log.createdAt).toLocaleString()}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          <div className="text-xs text-muted-foreground mt-3">Total: {data?.total ?? 0}</div>
        </CardContent>
      </Card>
    </div>
  );
}

function AdminFeatureFlags() {
  const { data: flags, isLoading } = useAdminGetFeatureFlags();
  const setFlag = useAdminSetFeatureFlag();

  const handleToggle = async (key: string, value: boolean) => {
    await setFlag.mutateAsync({ data: { key, value } });
  };

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Feature Flags</h1>
      <Card>
        <CardContent className="pt-4">
          {isLoading ? (
            <div className="text-center py-8 text-muted-foreground">Loading...</div>
          ) : (
            <div className="space-y-3">
              {flags?.map((flag) => (
                <div key={flag.id} className="flex items-center justify-between p-4 rounded-lg border">
                  <div>
                    <div className="font-mono text-sm font-medium">{flag.key}</div>
                    {flag.description && <div className="text-sm text-muted-foreground mt-0.5">{flag.description}</div>}
                    {flag.orgId && <Badge variant="secondary" className="text-xs mt-1">Org: {flag.orgId}</Badge>}
                  </div>
                  <Switch
                    checked={flag.value}
                    onCheckedChange={(checked) => handleToggle(flag.key, checked)}
                  />
                </div>
              ))}
              {!flags?.length && (
                <div className="text-center py-8 text-muted-foreground">No feature flags configured</div>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
