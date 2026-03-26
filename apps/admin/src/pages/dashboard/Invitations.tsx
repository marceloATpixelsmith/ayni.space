import React from "react";
import { useLocation } from "wouter";
import { useGetMe, useGetOrgInvitations, useCreateInvitation, useCancelInvitation } from "@workspace/api-client-react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useQueryClient } from "@tanstack/react-query";
import { Mail, X, Send } from "lucide-react";
import { useTurnstileToken } from "@workspace/frontend-security";

export default function Invitations() {
  const [, setLocation] = useLocation();
  const { data: user, isLoading: userLoading } = useGetMe();
  const queryClient = useQueryClient();
  const turnstile = useTurnstileToken();
  const [email, setEmail] = React.useState("");
  const [role, setRole] = React.useState("member");
  const [error, setError] = React.useState("");

  const orgId = user?.activeOrgId ?? "";
  const { data: invitations, isLoading } = useGetOrgInvitations(orgId, {
    query: { enabled: !!orgId, queryKey: ["getOrgInvitations", orgId] },
  });
  const createInvitation = useCreateInvitation();
  const cancelInvitation = useCancelInvitation();

  React.useEffect(() => {
    if (!userLoading && !user) setLocation("/login");
  }, [user, userLoading, setLocation]);

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (!email.trim()) return;
    if (turnstile.enabled && !turnstile.token) {
      setError("Please complete Turnstile verification before sending an invitation.");
      return;
    }
    try {
      await createInvitation.mutateAsync({
        orgId,
        data: { email: email.trim(), role: role as "owner" | "admin" | "member" | "viewer" },
      });
      setEmail("");
      turnstile.reset();
      queryClient.invalidateQueries({ queryKey: ["/api/organizations/{orgId}/invitations"] });
    } catch (err: unknown) {
      setError((err as { data?: { error?: string } })?.data?.error ?? "Failed to send invitation");
    }
  };

  const handleCancel = async (invitationId: string) => {
    await cancelInvitation.mutateAsync({ orgId, invitationId });
    queryClient.invalidateQueries({ queryKey: ["/api/organizations/{orgId}/invitations"] });
  };

  return (
    <AppLayout>
      <div className="p-6 space-y-6">
        <div className="flex items-center gap-3">
          <Mail className="w-6 h-6 text-primary" />
          <div>
            <h1 className="text-2xl font-bold">Invitations</h1>
            <p className="text-muted-foreground text-sm">Invite people to join your organization</p>
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Invite New Member</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleInvite} className="flex gap-3 items-end flex-wrap">
              <div className="flex-1 min-w-48">
                <label className="text-sm font-medium text-muted-foreground mb-1 block">Email address</label>
                <Input
                  type="email"
                  placeholder="colleague@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
              <div>
                <label className="text-sm font-medium text-muted-foreground mb-1 block">Role</label>
                <Select value={role} onValueChange={setRole}>
                  <SelectTrigger className="w-32">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="owner">Owner</SelectItem>
                    <SelectItem value="admin">Admin</SelectItem>
                    <SelectItem value="member">Member</SelectItem>
                    <SelectItem value="viewer">Viewer</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Button type="submit" disabled={createInvitation.isPending}>
                <Send className="w-4 h-4 mr-2" />
                Send Invite
              </Button>
            </form>
            {error && <p className="text-destructive text-sm mt-2">{error}</p>}
            {turnstile.enabled && (
              <div className="mt-4 space-y-2">
                <turnstile.TurnstileWidget />
                {turnstile.error && <p className="text-destructive text-sm">{turnstile.error}</p>}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Pending Invitations ({invitations?.length ?? 0})</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="text-center py-8 text-muted-foreground">Loading invitations...</div>
            ) : invitations?.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">No pending invitations</div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Email</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead>Expires</TableHead>
                    <TableHead className="w-20">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {invitations?.map((inv) => (
                    <TableRow key={inv.id}>
                      <TableCell className="font-medium">{inv.email}</TableCell>
                      <TableCell>
                        <Badge variant="secondary">{inv.role}</Badge>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {new Date(inv.expiresAt).toLocaleDateString()}
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-destructive hover:text-destructive"
                          onClick={() => handleCancel(inv.id)}
                        >
                          <X className="w-4 h-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}
