import React from "react";
import { useLocation } from "wouter";
import { useGetMe, useGetOrganization, useUpdateOrganization } from "@workspace/api-client-react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Settings as SettingsIcon, Check } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";

export default function Settings() {
  const [, setLocation] = useLocation();
  const { data: user, isLoading: userLoading } = useGetMe({ query: { retry: false } });
  const orgId = user?.activeOrgId ?? "";
  const { data: org } = useGetOrganization(orgId, { query: { enabled: !!orgId } });
  const updateOrg = useUpdateOrganization();
  const queryClient = useQueryClient();
  const [saved, setSaved] = React.useState(false);

  const [form, setForm] = React.useState({ name: "", website: "", logoUrl: "" });

  React.useEffect(() => {
    if (org) {
      setForm({
        name: org.name ?? "",
        website: org.website ?? "",
        logoUrl: org.logoUrl ?? "",
      });
    }
  }, [org]);

  React.useEffect(() => {
    if (!userLoading && !user) setLocation("/login");
  }, [user, userLoading, setLocation]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    await updateOrg.mutateAsync({
      orgId,
      data: { name: form.name, website: form.website || undefined, logoUrl: form.logoUrl || undefined },
    });
    queryClient.invalidateQueries();
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <AppLayout>
      <div className="p-6 space-y-6">
        <div className="flex items-center gap-3">
          <SettingsIcon className="w-6 h-6 text-primary" />
          <div>
            <h1 className="text-2xl font-bold">Organization Settings</h1>
            <p className="text-muted-foreground text-sm">Manage your organization's profile and preferences</p>
          </div>
        </div>

        <Card className="max-w-2xl">
          <CardHeader>
            <CardTitle>Organization Profile</CardTitle>
            <CardDescription>Update your organization's basic information</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSave} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="name">Organization Name</Label>
                <Input
                  id="name"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="My Organization"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="website">Website</Label>
                <Input
                  id="website"
                  value={form.website}
                  onChange={(e) => setForm({ ...form, website: e.target.value })}
                  placeholder="https://example.com"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="logoUrl">Logo URL</Label>
                <Input
                  id="logoUrl"
                  value={form.logoUrl}
                  onChange={(e) => setForm({ ...form, logoUrl: e.target.value })}
                  placeholder="https://example.com/logo.png"
                />
              </div>
              <div className="flex items-center gap-3 pt-2">
                <Button type="submit" disabled={updateOrg.isPending}>
                  {saved ? (
                    <>
                      <Check className="w-4 h-4 mr-2 text-green-500" />
                      Saved!
                    </>
                  ) : "Save Changes"}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>

        <Card className="max-w-2xl border-destructive/30">
          <CardHeader>
            <CardTitle className="text-destructive">Danger Zone</CardTitle>
            <CardDescription>Irreversible actions for your organization</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between p-4 rounded-lg border border-destructive/30">
              <div>
                <div className="font-medium">Delete Organization</div>
                <div className="text-sm text-muted-foreground">Permanently delete this organization and all its data</div>
              </div>
              <Button variant="destructive" size="sm" onClick={() => alert("Contact support to delete your organization.")}>
                Delete
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}
