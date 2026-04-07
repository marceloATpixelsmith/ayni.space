import React from "react";
import { useLocation } from "wouter";
import {
  getGetOrgInvitationsQueryKey,
  useGetMe,
  useGetOrgInvitations,
  useCreateInvitation,
  useCancelInvitation,
  useResendInvitation,
} from "@workspace/api-client-react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useQueryClient } from "@tanstack/react-query";
import { Mail, X, Send } from "lucide-react";
import { validateEmailInput } from "@workspace/frontend-security";
import { FieldValidationMessage } from "@workspace/auth-ui";

export default function Invitations() {
  const [, setLocation] = useLocation();
  const { data: user, isLoading: userLoading } = useGetMe();
  const queryClient = useQueryClient();
  const [email, setEmail] = React.useState("");
  const [firstName, setFirstName] = React.useState("");
  const [lastName, setLastName] = React.useState("");
  const [role, setRole] = React.useState("member");
  const [apiError, setApiError] = React.useState("");
  const [emailTouched, setEmailTouched] = React.useState(false);
  const [submitAttempted, setSubmitAttempted] = React.useState(false);

  const orgId = user?.activeOrgId ?? "";
  const { data: invitations, isLoading } = useGetOrgInvitations(orgId, {
    query: {
      queryKey: getGetOrgInvitationsQueryKey(orgId),
      enabled: !!orgId,
    },
  });
  const createInvitation = useCreateInvitation();
  const cancelInvitation = useCancelInvitation();
  const resendInvitation = useResendInvitation();

  React.useEffect(() => {
    if (!userLoading && !user) setLocation("/login");
  }, [user, userLoading, setLocation]);

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    setApiError("");
    setSubmitAttempted(true);
    const emailError = validateEmailInput(email);
    if (emailError) {
      return;
    }
    try {
      await createInvitation.mutateAsync({
        orgId,
        data: {
          email: email.trim(),
          firstName: firstName.trim() || undefined,
          lastName: lastName.trim() || undefined,
          role: role as "owner" | "admin" | "member" | "viewer",
        },
      });
      setEmail("");
      setFirstName("");
      setLastName("");
      setEmailTouched(false);
      setSubmitAttempted(false);
      await queryClient.invalidateQueries({ queryKey: getGetOrgInvitationsQueryKey(orgId) });
    } catch (err: unknown) {
      setApiError((err as { data?: { error?: string } })?.data?.error ?? "Failed to send invitation");
    }
  };

  const handleCancel = async (invitationId: string) => {
    await cancelInvitation.mutateAsync({ orgId, invitationId });
    await queryClient.invalidateQueries({ queryKey: getGetOrgInvitationsQueryKey(orgId) });
  };

  const handleResend = async (invitationId: string) => {
    await resendInvitation.mutateAsync({ orgId, invitationId });
    await queryClient.invalidateQueries({ queryKey: getGetOrgInvitationsQueryKey(orgId) });
  };

  const emailError = validateEmailInput(email);
  const showEmailError = (emailTouched || submitAttempted) && Boolean(emailError);

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
                  onBlur={() => setEmailTouched(true)}
                  aria-invalid={showEmailError}
                  aria-describedby={showEmailError ? "invitation-email-error" : undefined}
                />
                <FieldValidationMessage
                  id="invitation-email-error"
                  message={showEmailError ? emailError : null}
                />
              </div>
              <div className="min-w-40">
                <label className="text-sm font-medium text-muted-foreground mb-1 block">First name</label>
                <Input
                  type="text"
                  placeholder="Pat"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                />
              </div>
              <div className="min-w-40">
                <label className="text-sm font-medium text-muted-foreground mb-1 block">Last name</label>
                <Input
                  type="text"
                  placeholder="Lee"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
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
            {apiError && <p className="text-destructive text-sm mt-2">{apiError}</p>}
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
                    <TableHead className="w-40">Actions</TableHead>
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
                        <div className="flex items-center gap-2">
                          <Button variant="ghost" size="sm" onClick={() => handleResend(inv.id)}>
                            Resend
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-destructive hover:text-destructive"
                            onClick={() => handleCancel(inv.id)}
                          >
                            <X className="w-4 h-4" />
                          </Button>
                        </div>
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
