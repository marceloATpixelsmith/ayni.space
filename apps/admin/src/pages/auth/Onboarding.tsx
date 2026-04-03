import React from "react";
import { useLocation } from "wouter";
import { motion } from "framer-motion";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useCreateOrganization, useGetMe, getGetMeQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Form, FormControl, FormField, FormItem, FormMessage } from "@/components/ui/form";
import { Building2, ArrowRight } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useAuth, useTurnstileToken } from "@workspace/frontend-security";
import { captureApiFailure, getUserSafeErrorMessage } from "@workspace/frontend-observability";

const formSchema = z.object({
  name: z.string().min(2, "Organization name must be at least 2 characters"),
  slug: z.string().min(2, "Slug must be at least 2 characters").regex(/^[a-z0-9-]+$/, "Slug must contain only lowercase letters, numbers, and hyphens"),
});

export default function Onboarding() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const turnstile = useTurnstileToken();
  const auth = useAuth();
  const queryClient = useQueryClient();
  const { data: user, isLoading } = useGetMe();

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: "",
      slug: "",
    },
  });

  // Auto-generate slug from name
  React.useEffect(() => {
    const subscription = form.watch((value, { name }) => {
      if (name === "name" && value.name) {
        form.setValue("slug", value.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, ""), { shouldValidate: true });
      }
    });
    return () => subscription.unsubscribe();
  }, [form]);

  const { mutate: createOrg, isPending } = useCreateOrganization({
    mutation: {
      onSuccess: async () => {
        toast({ title: "Organization created successfully" });
        await auth.refreshSession();
        await queryClient.invalidateQueries({ queryKey: getGetMeQueryKey() });
        setLocation("/dashboard");
      },
      onError: (error: unknown, variables: { data: { name: string; slug: string } }) => {
        captureApiFailure(error, {
          area: "onboarding",
          action: "create_organization",
          route: "/onboarding/organization",
          app: "admin",
          user: {
            id: user?.id,
            email: user?.email,
          },
          extra: {
            organizationName: variables.data.name,
            slug: variables.data.slug,
          },
        });

        toast({
          title: "Failed to create organization",
          description: getUserSafeErrorMessage(error, "Please try again in a moment."),
          variant: "destructive"
        });
      }
    }
  });

  const onSubmit = (values: z.infer<typeof formSchema>) => {
    if (turnstile.enabled && !turnstile.token) {
      toast({
        title: "Complete verification",
        description: "Please complete Turnstile verification before creating an organization.",
        variant: "destructive",
      });
      return;
    }

    const payload = turnstile.token
      ? ({ ...values, "cf-turnstile-response": turnstile.token } as typeof values)
      : values;

    createOrg({
      data: payload,
    });
  };

  if (isLoading || !user) return null;

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950 p-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.4 }}
        className="w-full max-w-lg"
      >
        <div className="text-center mb-10">
          <div className="w-16 h-16 bg-primary/10 rounded-2xl flex items-center justify-center mx-auto mb-6 shadow-inner">
            <Building2 className="w-8 h-8 text-primary" />
          </div>
          <h1 className="text-3xl font-bold text-foreground">Set up your workspace</h1>
          <p className="text-muted-foreground mt-2">Create an organization to start using apps and inviting your team.</p>
        </div>

        <Card className="p-8 shadow-xl shadow-black/5 border-border/50">
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <Label className="text-sm font-semibold">Organization Name</Label>
                    <FormControl>
                      <Input placeholder="Acme Corp" className="h-12" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="slug"
                render={({ field }) => (
                  <FormItem>
                    <Label className="text-sm font-semibold">Workspace URL</Label>
                    <FormControl>
                      <div className="flex">
                        <span className="inline-flex items-center px-4 rounded-l-md border border-r-0 border-input bg-muted text-muted-foreground text-sm font-medium">
                          app.platform.com/
                        </span>
                        <Input placeholder="acme-corp" className="h-12 rounded-l-none" {...field} />
                      </div>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <Button type="submit" className="w-full h-12 text-base" disabled={isPending}>
                {isPending ? "Creating..." : (
                  <>
                    Continue to Dashboard <ArrowRight className="ml-2 w-4 h-4" />
                  </>
                )}
              </Button>
              {turnstile.enabled && (
                <div className="space-y-2 pt-2">
                  <turnstile.TurnstileWidget />
                  {turnstile.error && <p className="text-destructive text-sm">{turnstile.error}</p>}
                </div>
              )}
            </form>
          </Form>
        </Card>
      </motion.div>
    </div>
  );
}
