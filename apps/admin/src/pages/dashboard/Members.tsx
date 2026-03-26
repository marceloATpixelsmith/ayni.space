import React from "react";
import { useLocation } from "wouter";
import { useGetMe, useGetOrgMembers, useRemoveOrgMember, useUpdateOrgMemberRole } from "@workspace/api-client-react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useQueryClient } from "@tanstack/react-query";
import { Users, Trash2 } from "lucide-react";

const ROLE_COLORS: Record<string, string> = {
  owner: "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200",
  admin: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
  member: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  viewer: "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200",
};

export default function Members() {
  const [, setLocation] = useLocation();
  const { data: user, isLoading: userLoading } = useGetMe();
  const queryClient = useQueryClient();

  const orgId = user?.activeOrgId ?? "";
  const { data: members, isLoading } = useGetOrgMembers(orgId, {
    query: { enabled: !!orgId, queryKey: ["getOrgMembers", orgId] },
  });
  const removeMember = useRemoveOrgMember();
  const updateRole = useUpdateOrgMemberRole();

  React.useEffect(() => {
    if (!userLoading && !user) setLocation("/login");
  }, [user, userLoading, setLocation]);

  const currentMembership = members?.find((m) => m.userId === user?.id);
  const canManage = currentMembership?.role === "owner" || currentMembership?.role === "admin";

  const handleRemove = async (userId: string) => {
    if (!confirm("Remove this member from the organization?")) return;
    await removeMember.mutateAsync({ orgId, userId });
    queryClient.invalidateQueries({ queryKey: ["/api/organizations/{orgId}/members"] });
  };

  const handleRoleChange = async (userId: string, role: string) => {
    await updateRole.mutateAsync({ orgId, userId, data: { role: role as "owner" | "admin" | "member" | "viewer" } });
    queryClient.invalidateQueries({ queryKey: ["/api/organizations/{orgId}/members"] });
  };

  return (
    <AppLayout>
      <div className="p-6 space-y-6">
        <div className="flex items-center gap-3">
          <Users className="w-6 h-6 text-primary" />
          <div>
            <h1 className="text-2xl font-bold">Team Members</h1>
            <p className="text-muted-foreground text-sm">Manage who has access to your organization</p>
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Members ({members?.length ?? 0})</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="text-center py-8 text-muted-foreground">Loading members...</div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Member</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead>Joined</TableHead>
                    {canManage && <TableHead className="w-24">Actions</TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {members?.map((member) => (
                    <TableRow key={member.userId}>
                      <TableCell>
                        <div className="flex items-center gap-3">
                          <Avatar className="h-8 w-8">
                            <AvatarImage src={member.avatarUrl ?? undefined} />
                            <AvatarFallback>{(member.name ?? member.email)[0].toUpperCase()}</AvatarFallback>
                          </Avatar>
                          <div>
                            <div className="font-medium">{member.name ?? member.email}</div>
                            {member.name && <div className="text-xs text-muted-foreground">{member.email}</div>}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        {canManage && member.userId !== user?.id ? (
                          <Select
                            value={member.role}
                            onValueChange={(role) => handleRoleChange(member.userId, role)}
                          >
                            <SelectTrigger className="w-28 h-7 text-xs">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="owner">Owner</SelectItem>
                              <SelectItem value="admin">Admin</SelectItem>
                              <SelectItem value="member">Member</SelectItem>
                              <SelectItem value="viewer">Viewer</SelectItem>
                            </SelectContent>
                          </Select>
                        ) : (
                          <Badge className={`text-xs ${ROLE_COLORS[member.role] ?? ""}`}>
                            {member.role}
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {new Date(member.joinedAt).toLocaleDateString()}
                      </TableCell>
                      {canManage && (
                        <TableCell>
                          {member.userId !== user?.id && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="text-destructive hover:text-destructive"
                              onClick={() => handleRemove(member.userId)}
                            >
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          )}
                        </TableCell>
                      )}
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
