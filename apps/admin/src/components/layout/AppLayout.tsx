import React from "react";
import { Link, useLocation } from "wouter";
import { 
  Building2, 
  Settings, 
  Users, 
  CreditCard, 
  Mail, 
  LayoutGrid, 
  LogOut, 
  ShieldCheck, 
  ChevronDown,
  ActivitySquare
} from "lucide-react";
import { useAuth } from "@workspace/frontend-security";
import { 
  Sidebar, 
  SidebarContent, 
  SidebarGroup, 
  SidebarGroupContent, 
  SidebarGroupLabel, 
  SidebarMenu, 
  SidebarMenuButton, 
  SidebarMenuItem,
  SidebarProvider,
  SidebarHeader,
  SidebarFooter
} from "@/components/ui/sidebar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";

export function AppLayout({ children }: { children: React.ReactNode }) {
  const [location, setLocation] = useLocation();
  const auth = useAuth();
  const user = auth.user;
  const isLoading = auth.status === "loading";
  const isError = auth.status === "unauthenticated";
  const [logoutInFlight, setLogoutInFlight] = React.useState(false);

  React.useEffect(() => {
    if (isError) {
      setLocation("/login");
    }
  }, [isError, setLocation]);

  if (isLoading) {
    return (
      <div className="min-h-screen w-full flex items-center justify-center bg-background">
        <ActivitySquare className="w-10 h-10 text-primary animate-pulse" />
      </div>
    );
  }

  if (!user) {
    return null; // Will redirect in useEffect
  }

  const navItems = [
    { title: "Dashboard", url: "/dashboard", icon: LayoutGrid },
    { title: "Apps", url: "/dashboard/apps", icon: Building2 },
    { title: "Members", url: "/dashboard/members", icon: Users },
    { title: "Invitations", url: "/dashboard/invitations", icon: Mail },
    { title: "Billing", url: "/dashboard/billing", icon: CreditCard },
    { title: "Settings", url: "/dashboard/settings", icon: Settings },
  ];

  const handleLogout = React.useCallback(async () => {
    if (logoutInFlight) {
      return;
    }

    setLogoutInFlight(true);
    try {
      await auth.logout();
      setLocation("/login");
    } finally {
      setLogoutInFlight(false);
    }
  }, [auth, logoutInFlight, setLocation]);

  return (
    <SidebarProvider style={{ "--sidebar-width": "16rem", "--sidebar-width-icon": "4rem" } as React.CSSProperties}>
      <div className="flex min-h-screen w-full bg-slate-50 dark:bg-slate-950">
        <Sidebar className="border-r border-slate-200 dark:border-slate-800">
          <SidebarHeader className="p-4 border-b border-border/50">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" className="w-full justify-between px-2 py-6 hover-elevate bg-card">
                  <div className="flex items-center gap-3 overflow-hidden">
                    <div className="w-8 h-8 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0">
                      <Building2 className="w-4 h-4" />
                    </div>
                    <div className="flex flex-col items-start truncate">
                      <span className="text-sm font-semibold truncate w-full">{user.activeOrg?.name || "Platform Console"}</span>
                      <span className="text-xs text-muted-foreground">{user.isSuperAdmin ? "Super Admin" : "Member"}</span>
                    </div>
                  </div>
                  <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent className="w-64" align="start">
                <DropdownMenuLabel>Your Organizations</DropdownMenuLabel>
                {user.memberships?.map((membership) => (
                  <DropdownMenuItem 
                    key={membership.orgId}
                    className="cursor-pointer"
                    onClick={() => {
                      auth.switchOrganization(membership.orgId).then(() => {
                        setLocation("/dashboard");
                      });
                    }}
                  >
                    <div className="flex flex-col">
                      <span className="font-medium">{membership.orgName}</span>
                      <span className="text-xs text-muted-foreground capitalize">{membership.role}</span>
                    </div>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarHeader>

          <SidebarContent>
            <SidebarGroup>
              <SidebarGroupLabel>Workspace</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {navItems.map((item) => {
                    const isActive = location === item.url || (item.url !== "/dashboard" && location.startsWith(item.url));
                    return (
                      <SidebarMenuItem key={item.title}>
                        <SidebarMenuButton asChild isActive={isActive}>
                          <Link href={item.url} className="flex items-center gap-3">
                            <item.icon className="w-4 h-4" />
                            <span className="font-medium">{item.title}</span>
                          </Link>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    );
                  })}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>

            {user.isSuperAdmin && (
              <SidebarGroup>
                <SidebarGroupLabel>Platform Administration</SidebarGroupLabel>
                <SidebarGroupContent>
                  <SidebarMenu>
                    <SidebarMenuItem>
                      <SidebarMenuButton asChild isActive={location.startsWith("/admin")}>
                        <Link href="/admin" className="flex items-center gap-3">
                          <ShieldCheck className="w-4 h-4 text-primary" />
                          <span className="font-medium">Super Admin</span>
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  </SidebarMenu>
                </SidebarGroupContent>
              </SidebarGroup>
            )}
          </SidebarContent>

          <SidebarFooter className="p-4 border-t border-border/50">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" className="w-full justify-start px-2 py-6 hover-elevate">
                  <Avatar className="w-8 h-8 mr-3">
                    <AvatarImage src={user.avatarUrl || undefined} />
                    <AvatarFallback className="bg-primary/10 text-primary">
                      {user.name?.charAt(0) || user.email.charAt(0).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex flex-col items-start truncate">
                    <span className="text-sm font-medium truncate w-full">{user.name || "User"}</span>
                    <span className="text-xs text-muted-foreground truncate w-full">{user.email}</span>
                  </div>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel>My Account</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem className="text-destructive cursor-pointer" onClick={handleLogout} disabled={logoutInFlight}>
                  <LogOut className="w-4 h-4 mr-2" />
                  {logoutInFlight ? "Logging out..." : "Log out"}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarFooter>
        </Sidebar>

        <main className="flex-1 flex flex-col min-w-0 h-screen overflow-y-auto">
          {children}
        </main>
      </div>
    </SidebarProvider>
  );
}
