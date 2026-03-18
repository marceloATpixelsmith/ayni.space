import React from "react";
import { Link } from "wouter";
import { motion } from "framer-motion";
import { useGetMe, useGetOrgApps } from "@workspace/api-client-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { AppLayout } from "@/components/layout/AppLayout";
import { BookOpen, Users, ArrowRight, ExternalLink, LayoutGrid } from "lucide-react";

export default function DashboardHome() {
  const { data: user } = useGetMe();
  const { data: apps, isLoading } = useGetOrgApps(user?.activeOrgId || "", {
    query: { enabled: !!user?.activeOrgId }
  });

  return (
    <AppLayout>
      <div className="p-8 max-w-7xl mx-auto w-full">
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
        >
          <div className="mb-10">
            <h1 className="text-4xl font-extrabold text-foreground tracking-tight">
              Good afternoon, {user?.name?.split(" ")[0] || "there"}
            </h1>
            <p className="text-lg text-muted-foreground mt-2">
              Here's what's happening in your {user?.activeOrg?.name} workspace.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-10">
            <Card className="p-6 border-l-4 border-l-primary hover:shadow-lg transition-shadow">
              <h3 className="text-sm font-semibold text-muted-foreground mb-1 uppercase tracking-wider">Active Apps</h3>
              <p className="text-3xl font-bold">{apps?.filter(a => a.status === "active").length || 0}</p>
            </Card>
            <Card className="p-6 border-l-4 border-l-accent hover:shadow-lg transition-shadow">
              <h3 className="text-sm font-semibold text-muted-foreground mb-1 uppercase tracking-wider">Team Members</h3>
              <p className="text-3xl font-bold">{user?.activeOrg?.memberCount || 1}</p>
            </Card>
            <Card className="p-6 border-l-4 border-l-secondary hover:shadow-lg transition-shadow">
              <h3 className="text-sm font-semibold text-muted-foreground mb-1 uppercase tracking-wider">Billing Status</h3>
              <div className="mt-1">
                <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200 dark:bg-green-900/20 dark:text-green-400">
                  Healthy
                </Badge>
              </div>
            </Card>
          </div>

          <div className="flex items-center justify-between mb-6">
            <h2 className="text-2xl font-bold text-foreground">Your Apps</h2>
            <Button variant="outline" asChild>
              <Link href="/dashboard/apps">View App Directory</Link>
            </Button>
          </div>

          {isLoading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {[1, 2].map(i => (
                <Card key={i} className="p-6 h-48 animate-pulse bg-muted/50" />
              ))}
            </div>
          ) : apps?.length === 0 ? (
            <Card className="p-12 text-center border-dashed">
              <div className="w-16 h-16 bg-muted rounded-full flex items-center justify-center mx-auto mb-4">
                <LayoutGrid className="w-8 h-8 text-muted-foreground" />
              </div>
              <h3 className="text-xl font-semibold mb-2">No apps installed</h3>
              <p className="text-muted-foreground mb-6 max-w-md mx-auto">
                Head over to the App Directory to subscribe to tools and supercharge your workspace.
              </p>
              <Button asChild>
                <Link href="/dashboard/apps">Explore Apps <ArrowRight className="w-4 h-4 ml-2" /></Link>
              </Button>
            </Card>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {apps?.map((app) => (
                <Card key={app.appId} className="group overflow-hidden flex flex-col justify-between hover:shadow-xl hover:border-border transition-all duration-300">
                  <div className="p-6">
                    <div className="flex justify-between items-start mb-4">
                      <div className="w-12 h-12 bg-primary/10 text-primary rounded-xl flex items-center justify-center">
                        {app.appSlug === 'shipibo-dictionary' ? <BookOpen className="w-6 h-6" /> : <Users className="w-6 h-6" />}
                      </div>
                      <Badge variant={app.status === 'active' ? 'default' : 'secondary'} className="capitalize">
                        {app.status}
                      </Badge>
                    </div>
                    <h3 className="text-xl font-bold mb-2">{app.appName}</h3>
                    <p className="text-muted-foreground line-clamp-2">
                      {app.appSlug === 'shipibo-dictionary' 
                        ? 'Comprehensive indigenous language dictionary and translation tool.' 
                        : 'Manage ceremonies, participants, scheduling, and staff assignments.'}
                    </p>
                  </div>
                  <div className="p-4 bg-muted/30 border-t border-border/50">
                    <Button className="w-full" asChild>
                      <Link href={`/apps/${app.appSlug === 'shipibo-dictionary' ? 'shipibo' : 'ayni'}`}>
                        Launch App <ExternalLink className="w-4 h-4 ml-2" />
                      </Link>
                    </Button>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </motion.div>
      </div>
    </AppLayout>
  );
}
