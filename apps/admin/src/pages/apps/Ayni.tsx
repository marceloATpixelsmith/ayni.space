import React from "react";
import { useLocation } from "wouter";
import { useGetMe, useGetAyniCeremonies, useCreateAyniCeremony, useGetAyniParticipants } from "@workspace/api-client-react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useQueryClient } from "@tanstack/react-query";
import { Calendar, Users, MapPin, Plus } from "lucide-react";

const STATUS_COLORS: Record<string, string> = {
  draft: "bg-gray-100 text-gray-700",
  scheduled: "bg-blue-100 text-blue-700",
  in_progress: "bg-amber-100 text-amber-700",
  completed: "bg-green-100 text-green-700",
  cancelled: "bg-red-100 text-red-700",
};

export default function AyniApp() {
  const [, setLocation] = useLocation();
  const { data: user, isLoading: userLoading } = useGetMe({ query: { retry: false } });
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [selectedCeremonyId, setSelectedCeremonyId] = React.useState<string | null>(null);
  const [form, setForm] = React.useState({ name: "", description: "", location: "", scheduledAt: "" });

  const orgId = user?.activeOrgId ?? "";
  const { data: ceremoniesData, isLoading } = useGetAyniCeremonies(
    { orgId },
    { query: { enabled: !!orgId } }
  );
  const { data: participants } = useGetAyniParticipants(
    { ceremonyId: selectedCeremonyId ?? "" },
    { query: { enabled: !!selectedCeremonyId } }
  );
  const createCeremony = useCreateAyniCeremony();

  React.useEffect(() => {
    if (!userLoading && !user) setLocation("/login");
  }, [user, userLoading, setLocation]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    await createCeremony.mutateAsync({
      data: {
        orgId,
        name: form.name,
        description: form.description || undefined,
        location: form.location || undefined,
        scheduledAt: form.scheduledAt ? new Date(form.scheduledAt).toISOString() : undefined,
      },
    });
    setDialogOpen(false);
    setForm({ name: "", description: "", location: "", scheduledAt: "" });
    queryClient.invalidateQueries();
  };

  const ceremonies = ceremoniesData?.ceremonies ?? [];

  return (
    <AppLayout>
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Calendar className="w-6 h-6 text-primary" />
            <div>
              <h1 className="text-2xl font-bold">Ayni Ceremony Management</h1>
              <p className="text-muted-foreground text-sm">Schedule and manage ceremonies, participants, and staff</p>
            </div>
          </div>
          <Button onClick={() => setDialogOpen(true)}>
            <Plus className="w-4 h-4 mr-2" />
            New Ceremony
          </Button>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-4">
          <Card>
            <CardContent className="pt-6">
              <div className="text-2xl font-bold">{ceremonies.length}</div>
              <div className="text-sm text-muted-foreground">Total Ceremonies</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="text-2xl font-bold">{ceremonies.filter((c) => c.status === "scheduled").length}</div>
              <div className="text-sm text-muted-foreground">Scheduled</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="text-2xl font-bold">{ceremonies.reduce((acc, c) => acc + c.participantCount, 0)}</div>
              <div className="text-sm text-muted-foreground">Total Participants</div>
            </CardContent>
          </Card>
        </div>

        {/* Ceremonies Table */}
        <Card>
          <CardHeader>
            <CardTitle>Ceremonies</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="text-center py-8 text-muted-foreground">Loading ceremonies...</div>
            ) : ceremonies.length === 0 ? (
              <div className="text-center py-12">
                <Calendar className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
                <p className="font-medium text-muted-foreground">No ceremonies yet</p>
                <p className="text-sm text-muted-foreground mt-1">Create your first ceremony to get started</p>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Ceremony</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead>Location</TableHead>
                    <TableHead>Participants</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {ceremonies.map((ceremony) => (
                    <TableRow key={ceremony.id}>
                      <TableCell>
                        <div className="font-medium">{ceremony.name}</div>
                        {ceremony.description && (
                          <div className="text-xs text-muted-foreground truncate max-w-48">{ceremony.description}</div>
                        )}
                      </TableCell>
                      <TableCell className="text-sm">
                        {ceremony.scheduledAt
                          ? new Date(ceremony.scheduledAt).toLocaleDateString()
                          : <span className="text-muted-foreground">TBD</span>}
                      </TableCell>
                      <TableCell className="text-sm">
                        {ceremony.location ? (
                          <div className="flex items-center gap-1">
                            <MapPin className="w-3 h-3 text-muted-foreground" />
                            {ceremony.location}
                          </div>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          <Users className="w-4 h-4 text-muted-foreground" />
                          <span>{ceremony.participantCount}</span>
                          {ceremony.capacity && (
                            <span className="text-muted-foreground text-xs">/{ceremony.capacity}</span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge className={`text-xs ${STATUS_COLORS[ceremony.status] ?? ""}`}>
                          {ceremony.status.replace("_", " ")}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setSelectedCeremonyId(
                            selectedCeremonyId === ceremony.id ? null : ceremony.id
                          )}
                        >
                          {selectedCeremonyId === ceremony.id ? "Hide" : "View"} Participants
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        {/* Participants panel for selected ceremony */}
        {selectedCeremonyId && (
          <Card>
            <CardHeader>
              <CardTitle>
                Participants — {ceremonies.find((c) => c.id === selectedCeremonyId)?.name}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {!participants || participants.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">No participants registered yet</div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Email</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Registered</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {participants.map((p) => (
                      <TableRow key={p.id}>
                        <TableCell className="font-medium">{p.name}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">{p.email ?? "—"}</TableCell>
                        <TableCell>
                          <Badge variant="secondary" className="text-xs">{p.status}</Badge>
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {new Date(p.registeredAt).toLocaleDateString()}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        )}

        {/* New Ceremony Dialog */}
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Create New Ceremony</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleCreate} className="space-y-4">
              <div className="space-y-2">
                <Label>Ceremony Name *</Label>
                <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required placeholder="Spring Healing Ceremony" />
              </div>
              <div className="space-y-2">
                <Label>Description</Label>
                <Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Brief description..." rows={3} />
              </div>
              <div className="space-y-2">
                <Label>Location</Label>
                <Input value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} placeholder="Sacred Center, Peru" />
              </div>
              <div className="space-y-2">
                <Label>Scheduled Date & Time</Label>
                <Input type="datetime-local" value={form.scheduledAt} onChange={(e) => setForm({ ...form, scheduledAt: e.target.value })} />
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
                <Button type="submit" disabled={createCeremony.isPending}>Create Ceremony</Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>
    </AppLayout>
  );
}
