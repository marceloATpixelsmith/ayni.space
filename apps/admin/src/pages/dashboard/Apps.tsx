import React from "react";
import { motion } from "framer-motion";
import { useGetApps, useGetOrgSubscriptions, useGetMe, useCreateCheckoutSession } from "@workspace/api-client-react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Check, BookOpen, Users } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

export default function AppsDirectory() {
  const { toast } = useToast();
  const { data: user } = useGetMe();
  const orgId = user?.activeOrgId || "";
  
  const { data: apps, isLoading: appsLoading } = useGetApps();
  const { data: subscriptions, isLoading: subsLoading } = useGetOrgSubscriptions(orgId, {
    query: { enabled: !!orgId }
  });

  const { mutate: createCheckout, isPending: isCheckingOut } = useCreateCheckoutSession({
    mutation: {
      onSuccess: (data) => {
        window.location.href = data.url;
      },
      onError: () => {
        toast({ title: "Failed to initiate checkout", variant: "destructive" });
      }
    }
  });

  const handleSubscribe = (appId: string, planId: string) => {
    createCheckout({
      data: {
        orgId,
        appId,
        planId,
        successUrl: `${window.location.origin}/dashboard`,
        cancelUrl: `${window.location.origin}/dashboard/apps`
      }
    });
  };

  return (
    <AppLayout>
      <div className="p-8 max-w-7xl mx-auto w-full">
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
          <div className="mb-10">
            <h1 className="text-3xl font-bold text-foreground">App Directory</h1>
            <p className="text-muted-foreground mt-2">Discover and install powerful tools for your workspace.</p>
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-8">
            {apps?.map((app) => {
              const isSubscribed = subscriptions?.some(s => s.appId === app.id && s.status === 'active');
              const mainPlan = app.plans?.[0]; // Simplification for demo

              return (
                <Card key={app.id} className="overflow-hidden flex flex-col border-border/60 shadow-lg">
                  <div className="p-8 pb-0">
                    <div className="flex justify-between items-start mb-6">
                      <div className="w-16 h-16 bg-primary/10 rounded-2xl flex items-center justify-center text-primary shadow-inner">
                        {app.slug === 'shipibo-dictionary' ? <BookOpen className="w-8 h-8" /> : <Users className="w-8 h-8" />}
                      </div>
                      {isSubscribed && (
                        <Badge className="bg-green-100 text-green-800 border-green-200 dark:bg-green-900/30 dark:text-green-400">
                          Installed
                        </Badge>
                      )}
                    </div>
                    <h2 className="text-2xl font-bold mb-3">{app.name}</h2>
                    <p className="text-muted-foreground leading-relaxed h-16">
                      {app.description || "Powerful functionality to enhance your platform experience."}
                    </p>
                  </div>
                  
                  <div className="p-8 pt-6 mt-auto">
                    <div className="mb-6 space-y-3">
                      {mainPlan?.features?.slice(0, 3).map((feature, i) => (
                        <div key={i} className="flex items-center text-sm">
                          <div className="w-5 h-5 rounded-full bg-primary/10 flex items-center justify-center mr-3 shrink-0">
                            <Check className="w-3 h-3 text-primary" />
                          </div>
                          <span>{feature}</span>
                        </div>
                      ))}
                    </div>

                    <div className="flex items-center justify-between pt-6 border-t border-border/50">
                      <div>
                        <span className="text-3xl font-bold">${(mainPlan?.priceMonthly || 0) / 100}</span>
                        <span className="text-muted-foreground text-sm">/mo</span>
                      </div>
                      {isSubscribed ? (
                        <Button variant="outline" disabled>Currently Active</Button>
                      ) : (
                        <Button 
                          onClick={() => handleSubscribe(app.id, mainPlan?.id || "")}
                          disabled={isCheckingOut || !mainPlan}
                        >
                          {isCheckingOut ? "Loading..." : "Subscribe Now"}
                        </Button>
                      )}
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        </motion.div>
      </div>
    </AppLayout>
  );
}
