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
  useAdminGetSettings,
  useAdminUpsertAppSetting,
  useAdminUpsertGlobalSetting,
  useGetApps,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Building2, Users, Activity, Flag, LayoutDashboard, LogOut, Mail, Settings } from "lucide-react";
import { adminAccessDeniedLoginPath } from "../auth/accessDenied";
import { useAuth } from "@workspace/frontend-security";

type TemplateType = "invitation" | "email_verification" | "password_reset";

type TemplateState = {
  templateType: TemplateType;
  source: "app" | "platform";
  template: { subjectTemplate: string; htmlTemplate: string; textTemplate?: string | null } | null;
  appOverride: { subjectTemplate: string; htmlTemplate: string; textTemplate?: string | null } | null;
  tokens: string[];
  sampleData: Record<string, string>;
};

const NAV = [
  { id: "overview", label: "Overview", icon: LayoutDashboard },
  { id: "organizations", label: "Organizations", icon: Building2 },
  { id: "users", label: "Users", icon: Users },
  { id: "audit-logs", label: "Audit Logs", icon: Activity },
  { id: "feature-flags", label: "Feature Flags", icon: Flag },
  { id: "settings", label: "Runtime Settings", icon: Settings },
  { id: "email-templates", label: "Email Templates", icon: Mail },
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
      <aside className="w-56 bg-sidebar border-r border-sidebar-border flex flex-col">
        <div className="p-4 border-b border-sidebar-border">
          <div className="font-bold text-lg text-sidebar-foreground">Super Admin</div>
          <div className="text-xs text-muted-foreground mt-0.5">{user?.email}</div>
        </div>
        <nav className="flex-1 p-3 space-y-1">
          {NAV.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setLocation(id === "overview" ? "/dashboard" : `/dashboard/${id}`)}
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

      <main className="flex-1 overflow-auto p-6">
        {section === "overview" && <AdminOverview />}
        {section === "organizations" && <AdminOrgs />}
        {section === "users" && <AdminUsers />}
        {section === "audit-logs" && <AdminAuditLogs />}
        {section === "feature-flags" && <AdminFeatureFlags />}
        {section === "settings" && <AdminRuntimeSettings />}
        {section === "email-templates" && <AdminEmailTemplates />}
      </main>
    </div>
  );
}

function AdminOverview() { const { data: stats, isLoading } = useAdminGetStats(); return <div className="space-y-6"><h1 className="text-2xl font-bold">Platform Overview</h1><div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">{[{ label: "Total Users", value: stats?.totalUsers },{ label: "Organizations", value: stats?.totalOrgs },{ label: "Total Subscriptions", value: stats?.totalSubscriptions },{ label: "Active Subscriptions", value: stats?.activeSubscriptions },{ label: "Apps in Registry", value: stats?.totalApps }].map(({ label, value }) => (<Card key={label}><CardContent className="pt-6"><div className="text-2xl font-bold">{isLoading ? "..." : value ?? 0}</div><div className="text-xs text-muted-foreground mt-1">{label}</div></CardContent></Card>))}</div></div>; }

function AdminOrgs() { const { data, isLoading } = useAdminGetOrganizations({}); return <div className="space-y-4"><h1 className="text-2xl font-bold">All Organizations</h1><Card><CardContent className="pt-4">{isLoading ? <div className="text-center py-8 text-muted-foreground">Loading...</div> : <Table><TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Slug</TableHead><TableHead>Stripe Customer</TableHead><TableHead>Created</TableHead></TableRow></TableHeader><TableBody>{data?.organizations.map((org) => (<TableRow key={org.id}><TableCell className="font-medium">{org.name}</TableCell><TableCell><Badge variant="secondary" className="font-mono text-xs">{org.slug}</Badge></TableCell><TableCell className="text-xs text-muted-foreground font-mono">{org.stripeCustomerId ?? "—"}</TableCell><TableCell className="text-sm text-muted-foreground">{new Date(org.createdAt).toLocaleDateString()}</TableCell></TableRow>))}</TableBody></Table>}<div className="text-xs text-muted-foreground mt-3">Total: {data?.total ?? 0}</div></CardContent></Card></div>; }

function AdminUsers() { const { data, isLoading } = useAdminGetUsers({}); return <div className="space-y-4"><h1 className="text-2xl font-bold">All Users</h1><Card><CardContent className="pt-4">{isLoading ? <div className="text-center py-8 text-muted-foreground">Loading...</div> : <Table><TableHeader><TableRow><TableHead>Email</TableHead><TableHead>Name</TableHead><TableHead>Role</TableHead><TableHead>Joined</TableHead></TableRow></TableHeader><TableBody>{data?.users.map((u) => (<TableRow key={u.id}><TableCell className="font-medium">{u.email}</TableCell><TableCell className="text-muted-foreground">{u.name ?? "—"}</TableCell><TableCell>{u.isSuperAdmin && <Badge className="bg-amber-100 text-amber-800 text-xs">Super Admin</Badge>}</TableCell><TableCell className="text-sm text-muted-foreground">{new Date(u.createdAt).toLocaleDateString()}</TableCell></TableRow>))}</TableBody></Table>}<div className="text-xs text-muted-foreground mt-3">Total: {data?.total ?? 0}</div></CardContent></Card></div>; }

function AdminAuditLogs() { const { data, isLoading } = useAdminGetAuditLogs({}); return <div className="space-y-4"><h1 className="text-2xl font-bold">Audit Logs</h1><Card><CardContent className="pt-4">{isLoading ? <div className="text-center py-8 text-muted-foreground">Loading...</div> : <Table><TableHeader><TableRow><TableHead>Action</TableHead><TableHead>User</TableHead><TableHead>Resource</TableHead><TableHead>Date</TableHead></TableRow></TableHeader><TableBody>{data?.logs.map((log) => (<TableRow key={log.id}><TableCell><Badge variant="outline" className="font-mono text-xs">{log.action}</Badge></TableCell><TableCell className="text-sm text-muted-foreground">{log.userEmail ?? "system"}</TableCell><TableCell className="text-sm text-muted-foreground">{log.resourceType}{log.resourceId ? `:${log.resourceId.slice(0, 8)}` : ""}</TableCell><TableCell className="text-xs text-muted-foreground">{new Date(log.createdAt).toLocaleString()}</TableCell></TableRow>))}</TableBody></Table>}<div className="text-xs text-muted-foreground mt-3">Total: {data?.total ?? 0}</div></CardContent></Card></div>; }

function AdminFeatureFlags() {
  const { data: flags, isLoading } = useAdminGetFeatureFlags();
  const setFlag = useAdminSetFeatureFlag();
  return <div className="space-y-4"><h1 className="text-2xl font-bold">Feature Flags</h1><Card><CardContent className="pt-4">{isLoading ? <div className="text-center py-8 text-muted-foreground">Loading...</div> : <div className="space-y-3">{flags?.map((flag) => (<div key={flag.id} className="flex items-center justify-between p-4 rounded-lg border"><div><div className="font-mono text-sm font-medium">{flag.key}</div>{flag.description && <div className="text-sm text-muted-foreground mt-0.5">{flag.description}</div>}{flag.orgId && <Badge variant="secondary" className="text-xs mt-1">Org: {flag.orgId}</Badge>}</div><Switch checked={flag.value} onCheckedChange={(checked) => setFlag.mutateAsync({ data: { key: flag.key, value: checked } })} /></div>))}{!flags?.length && <div className="text-center py-8 text-muted-foreground">No feature flags configured</div>}</div>}</CardContent></Card></div>;
}

type SettingValueType = "string" | "number" | "boolean" | "json";
type RuntimeSetting = {
  id: string;
  appId?: string | null;
  appSlug?: string | null;
  key: string;
  value: string;
  valueType: SettingValueType;
  description?: string | null;
};

function parseSettingValue(valueType: SettingValueType, value: string): unknown {
  if (valueType === "boolean") return value.trim().toLowerCase() === "true";
  if (valueType === "number") return Number(value);
  if (valueType === "json") {
    try {
      return JSON.parse(value);
    } catch {
      return {};
    }
  }
  return value;
}

function AdminRuntimeSettings() {
  const { data, isLoading, refetch } = useAdminGetSettings();
  const { data: apps } = useGetApps();
  const upsertGlobal = useAdminUpsertGlobalSetting();
  const upsertApp = useAdminUpsertAppSetting();

  const [globalDrafts, setGlobalDrafts] = React.useState<Record<string, string>>({});
  const [appDrafts, setAppDrafts] = React.useState<Record<string, string>>({});

  const saveGlobal = async (setting: RuntimeSetting) => {
    const value = globalDrafts[setting.key] ?? setting.value;
    await upsertGlobal.mutateAsync({
      key: setting.key,
      data: {
        valueType: setting.valueType,
        value: parseSettingValue(setting.valueType, value),
        description: setting.description ?? null,
      },
    });
    await refetch();
  };

  const saveApp = async (setting: RuntimeSetting) => {
    if (!setting.appId) return;
    const draftKey = `${setting.appId}:${setting.key}`;
    const value = appDrafts[draftKey] ?? setting.value;
    await upsertApp.mutateAsync({
      appId: setting.appId,
      key: setting.key,
      data: {
        valueType: setting.valueType,
        value: parseSettingValue(setting.valueType, value),
        description: setting.description ?? null,
      },
    });
    await refetch();
  };

  const appSettingsBySlug = React.useMemo(() => {
    const grouped = new Map<string, RuntimeSetting[]>();
    for (const row of (data?.appSettings ?? []) as RuntimeSetting[]) {
      const slug = row.appSlug ?? "unknown";
      const bucket = grouped.get(slug) ?? [];
      bucket.push(row);
      grouped.set(slug, bucket);
    }
    return grouped;
  }, [data?.appSettings]);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Runtime Settings</h1>
      <p className="text-sm text-muted-foreground">
        Manage non-secret runtime configuration. Bootstrap env should only remain for API base URL, app slug, and base path.
      </p>

      <Card>
        <CardHeader>
          <CardTitle>Global Settings</CardTitle>
          <CardDescription>Shared across apps (non-secret only).</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {isLoading && <div className="text-muted-foreground">Loading settings…</div>}
          {((data?.globalSettings ?? []) as RuntimeSetting[]).map((setting) => (
            <div key={setting.id} className="grid grid-cols-12 gap-2 items-center border rounded-md p-3">
              <div className="col-span-3">
                <div className="font-mono text-xs">{setting.key}</div>
                <div className="text-xs text-muted-foreground">{setting.valueType}</div>
              </div>
              <Input
                className="col-span-7"
                value={globalDrafts[setting.key] ?? setting.value}
                onChange={(e) => setGlobalDrafts((prev) => ({ ...prev, [setting.key]: e.target.value }))}
              />
              <Button className="col-span-2" size="sm" onClick={() => void saveGlobal(setting)}>
                Save
              </Button>
              {setting.description && <div className="col-span-12 text-xs text-muted-foreground">{setting.description}</div>}
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>App Settings</CardTitle>
          <CardDescription>Per-app frontend runtime values (non-secret only).</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {(apps ?? []).map((app) => (
            <div key={app.id} className="border rounded-md p-3 space-y-2">
              <div className="font-semibold">{app.name} <span className="text-xs text-muted-foreground">({app.slug})</span></div>
              {(appSettingsBySlug.get(app.slug) ?? []).map((setting) => {
                const draftKey = `${setting.appId}:${setting.key}`;
                return (
                  <div key={setting.id} className="grid grid-cols-12 gap-2 items-center">
                    <div className="col-span-3">
                      <div className="font-mono text-xs">{setting.key}</div>
                      <div className="text-xs text-muted-foreground">{setting.valueType}</div>
                    </div>
                    <Input
                      className="col-span-7"
                      value={appDrafts[draftKey] ?? setting.value}
                      onChange={(e) => setAppDrafts((prev) => ({ ...prev, [draftKey]: e.target.value }))}
                    />
                    <Button className="col-span-2" size="sm" onClick={() => void saveApp(setting)}>
                      Save
                    </Button>
                  </div>
                );
              })}
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

function AdminEmailTemplates() {
  const [apps, setApps] = React.useState<Array<{ id: string; name: string }>>([]);
  const [appId, setAppId] = React.useState("");
  const [templates, setTemplates] = React.useState<TemplateState[]>([]);
  const [editing, setEditing] = React.useState<TemplateState | null>(null);
  const [mode, setMode] = React.useState<"wysiwyg" | "source">("wysiwyg");
  const [subject, setSubject] = React.useState("");
  const [html, setHtml] = React.useState("");
  const [text, setText] = React.useState("");
  const [preview, setPreview] = React.useState<{ subject: string; html: string; text: string } | null>(null);

  React.useEffect(() => { (async () => {
    const response = await fetch("/api/apps", { credentials: "include" });
    const data = await response.json();
    setApps((data ?? []).map((a: any) => ({ id: a.id, name: a.name })));
  })(); }, []);

  React.useEffect(() => { if (!appId) return; (async () => {
    const response = await fetch(`/api/admin/apps/${appId}/email-templates`, { credentials: "include" });
    const data = await response.json();
    setTemplates(data.templates ?? []);
  })(); }, [appId]);

  const loadPreview = async (templateType: TemplateType) => {
    if (!appId) return;
    const response = await fetch(`/api/admin/apps/${appId}/email-templates/${templateType}/preview`, {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ subjectTemplate: subject, htmlTemplate: html, textTemplate: text }),
    });
    const data = await response.json();
    setPreview(data);
  };

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Email Templates</h1>
      <Card><CardContent className="pt-4 space-y-3">
        <label className="text-sm">Select app</label>
        <select value={appId} onChange={(e) => setAppId(e.target.value)} className="border rounded p-2 w-full max-w-md">
          <option value="">Choose app...</option>
          {apps.map((app) => <option key={app.id} value={app.id}>{app.name}</option>)}
        </select>
      </CardContent></Card>

      {!!templates.length && <Card><CardContent className="pt-4"><Table><TableHeader><TableRow><TableHead>Type</TableHead><TableHead>Source</TableHead><TableHead>Tokens</TableHead><TableHead /></TableRow></TableHeader><TableBody>{templates.map((row) => <TableRow key={row.templateType}><TableCell className="font-medium">{row.templateType}</TableCell><TableCell><Badge variant={row.source === "app" ? "default" : "secondary"}>{row.source === "app" ? "App override" : "Platform default"}</Badge></TableCell><TableCell className="text-xs text-muted-foreground">{row.tokens.map((t) => `{{${t}}}`).join(", ")}</TableCell><TableCell><Button size="sm" onClick={() => { setEditing(row); setSubject(row.appOverride?.subjectTemplate ?? row.template?.subjectTemplate ?? ""); setHtml(row.appOverride?.htmlTemplate ?? row.template?.htmlTemplate ?? ""); setText(row.appOverride?.textTemplate ?? row.template?.textTemplate ?? ""); setPreview(null); }}>Edit</Button></TableCell></TableRow>)}</TableBody></Table></CardContent></Card>}

      {editing && <Card><CardHeader><CardTitle>Edit {editing.templateType}</CardTitle></CardHeader><CardContent className="space-y-3">
        <Input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Subject template" />
        <div className="flex gap-2">
          <Button variant={mode === "wysiwyg" ? "default" : "outline"} size="sm" onClick={() => setMode("wysiwyg")}>WYSIWYG</Button>
          <Button variant={mode === "source" ? "default" : "outline"} size="sm" onClick={() => setMode("source")}>Source</Button>
        </div>
        {mode === "source" ? (
          <Textarea value={html} onChange={(e) => setHtml(e.target.value)} rows={10} />
        ) : (
          <div className="border rounded min-h-48 p-3" contentEditable suppressContentEditableWarning onInput={(e) => setHtml((e.target as HTMLDivElement).innerHTML)} dangerouslySetInnerHTML={{ __html: html }} />
        )}
        <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={4} placeholder="Optional plain text template" />
        <div className="text-xs text-muted-foreground">Allowed tokens: {editing.tokens.map((t) => `{{${t}}}`).join(", ")}</div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => loadPreview(editing.templateType)}>Preview</Button>
          <Button onClick={async () => {
            await fetch(`/api/admin/apps/${appId}/email-templates/${editing.templateType}`, {
              method: "PUT",
              credentials: "include",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ subjectTemplate: subject, htmlTemplate: html, textTemplate: text }),
            });
            const response = await fetch(`/api/admin/apps/${appId}/email-templates`, { credentials: "include" });
            const data = await response.json();
            setTemplates(data.templates ?? []);
          }}>Save</Button>
          <Button variant="destructive" onClick={async () => {
            await fetch(`/api/admin/apps/${appId}/email-templates/${editing.templateType}`, { method: "DELETE", credentials: "include" });
            const response = await fetch(`/api/admin/apps/${appId}/email-templates`, { credentials: "include" });
            const data = await response.json();
            setTemplates(data.templates ?? []);
          }}>Reset Override</Button>
        </div>
        {preview && <div className="border rounded p-3 bg-muted/20"><div className="font-semibold">{preview.subject}</div><div className="mt-2 text-sm" dangerouslySetInnerHTML={{ __html: preview.html }} /></div>}
      </CardContent></Card>}
    </div>
  );
}
