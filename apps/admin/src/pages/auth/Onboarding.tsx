import React from "react";
import { useLocation } from "wouter";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  useCreateOrganization,
  useGetMe,
  getGetMeQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormMessage,
} from "@/components/ui/form";
import { Building2, ArrowRight } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import {
  secureApiFetch,
  useAuth,
  useTurnstileToken,
} from "@workspace/frontend-security";
import {
  captureApiFailure,
  getUserSafeErrorMessage,
} from "@workspace/frontend-observability";
import {
  AuthShell,
  AuthFormMotion,
  AuthI18nProvider,
  useAuthI18n,
} from "@workspace/auth-ui";

const formSchema = z.object({
  name: z.string().min(2, "Organization name must be at least 2 characters"),
  slug: z
    .string()
    .min(2, "Slug must be at least 2 characters")
    .regex(
      /^[a-z0-9-]+$/,
      "Slug must contain only lowercase letters, numbers, and hyphens",
    ),
});

function OnboardingContent() {
  const { t } = useAuthI18n();
  const [location, setLocation] = useLocation();
  const { toast } = useToast();
  const turnstile = useTurnstileToken();
  const auth = useAuth();
  const queryClient = useQueryClient();
  const { data: user, isLoading } = useGetMe();
  const isUserOnboarding = location === "/onboarding/user";

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
        form.setValue(
          "slug",
          value.name
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/(^-|-$)/g, ""),
          { shouldValidate: true },
        );
      }
    });
    return () => subscription.unsubscribe();
  }, [form]);

  const { mutate: createOrg, isPending } = useCreateOrganization({
    mutation: {
      onSuccess: async () => {
        toast({ title: "Organization created successfully" });
        if (!auth.csrfReady || !auth.csrfToken) {
          throw new Error("Security token not ready");
        }
        const nextResponse = await secureApiFetch(
          "/api/auth/post-onboarding/next-path",
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({}),
          },
          auth.csrfToken,
        );
        const nextPayload = (await nextResponse.json().catch(() => null)) as {
          nextPath?: string;
        } | null;
        await auth.refreshSession();
        await queryClient.invalidateQueries({ queryKey: getGetMeQueryKey() });
        if (nextPayload?.nextPath) {
          setLocation(nextPayload.nextPath);
        } else {
          setLocation("/");
        }
      },
      onError: (
        error: unknown,
        variables: { data: { name: string; slug: string } },
      ) => {
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
          description: getUserSafeErrorMessage(
            error,
            "Please try again in a moment.",
          ),
          variant: "destructive",
        });
      },
    },
  });

  const onSubmit = (values: z.infer<typeof formSchema>) => {
    if (isUserOnboarding) return;
    if (!auth.csrfReady || !auth.csrfToken) {
      toast({
        title: "Security token not ready",
        description: "Please wait a moment and try submitting again.",
        variant: "destructive",
      });
      return;
    }

    if (turnstile.enabled && !turnstile.token) {
      toast({
        title: "Complete verification",
        description:
          "Please complete Turnstile verification before creating an organization.",
        variant: "destructive",
      });
      return;
    }

    const payload = turnstile.token
      ? ({
          ...values,
          "cf-turnstile-response": turnstile.token,
        } as typeof values)
      : values;

    createOrg({
      data: payload,
    });
  };

  const [fullName, setFullName] = React.useState("");
  const [savingUserProfile, setSavingUserProfile] = React.useState(false);

  const submitUserOnboarding = React.useCallback(async () => {
    if (!fullName.trim()) {
      toast({
        title: "Name is required",
        description: "Please enter your full name to continue.",
        variant: "destructive",
      });
      return;
    }
    if (!auth.csrfReady || !auth.csrfToken) {
      toast({
        title: "Security token not ready",
        description: "Please wait a moment and try submitting again.",
        variant: "destructive",
      });
      return;
    }

    setSavingUserProfile(true);
    try {
      const response = await secureApiFetch(
        "/api/users/me",
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name: fullName.trim() }),
        },
        auth.csrfToken,
      );
      const payload = (await response.json().catch(() => null)) as {
        error?: string;
      } | null;
      if (!response.ok) {
        throw new Error(payload?.error ?? "Unable to save your profile.");
      }
      const nextResponse = await secureApiFetch(
        "/api/auth/post-onboarding/next-path",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({}),
        },
        auth.csrfToken,
      );
      const nextPayload = (await nextResponse.json().catch(() => null)) as {
        nextPath?: string;
      } | null;
      await auth.refreshSession();
      await queryClient.invalidateQueries({ queryKey: getGetMeQueryKey() });
      if (nextPayload?.nextPath) {
        setLocation(nextPayload.nextPath);
      } else {
        setLocation("/");
      }
    } catch (error) {
      toast({
        title: "Failed to save profile",
        description: getUserSafeErrorMessage(
          error,
          "Please try again in a moment.",
        ),
        variant: "destructive",
      });
    } finally {
      setSavingUserProfile(false);
    }
  }, [auth, fullName, queryClient, setLocation, toast]);

  if (isLoading || !user) return null;

  if (isUserOnboarding) {
    return (
      <AuthShell maxWidthClassName="max-w-lg">
        <AuthFormMotion>
          <div className="text-center mb-10">
            <h1 className="text-3xl font-bold text-foreground">
              {t("onboarding_user_title", "Complete your profile")}
            </h1>
            <p className="text-muted-foreground mt-2">
              {t(
                "onboarding_user_subtitle",
                "Tell us your name to continue to your dashboard.",
              )}
            </p>
          </div>
          <Card className="p-8 shadow-xl shadow-black/5 border-border/50 space-y-4">
            <Label className="text-sm font-semibold">
              {t("onboarding_user_full_name_label", "Full name")}
            </Label>
            <Input
              placeholder={t(
                "onboarding_user_full_name_placeholder",
                "Jane Doe",
              )}
              className="h-12"
              value={fullName}
              onChange={(event) => setFullName(event.target.value)}
              autoComplete="name"
            />
            <Button
              className="w-full h-12 text-base"
              disabled={savingUserProfile || !fullName.trim()}
              onClick={submitUserOnboarding}
            >
              {savingUserProfile
                ? t("onboarding_user_save_loading", "Saving...")
                : t("onboarding_user_continue_button", "Continue to Dashboard")}
            </Button>
          </Card>
        </AuthFormMotion>
      </AuthShell>
    );
  }

  return (
    <AuthShell maxWidthClassName="max-w-lg">
      <AuthFormMotion>
        <div className="text-center mb-10">
          <div className="w-16 h-16 bg-primary/10 rounded-2xl flex items-center justify-center mx-auto mb-6 shadow-inner">
            <Building2 className="w-8 h-8 text-primary" />
          </div>
          <h1 className="text-3xl font-bold text-foreground">
            Set up your workspace
          </h1>
          <p className="text-muted-foreground mt-2">
            Create an organization to start using apps and inviting your team.
          </p>
        </div>

        <Card className="p-8 shadow-xl shadow-black/5 border-border/50">
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <Label className="text-sm font-semibold">
                      Organization Name
                    </Label>
                    <FormControl>
                      <Input
                        placeholder="Acme Corp"
                        className="h-12"
                        {...field}
                      />
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
                    <Label className="text-sm font-semibold">
                      Workspace URL
                    </Label>
                    <FormControl>
                      <div className="flex">
                        <span className="inline-flex items-center px-4 rounded-l-md border border-r-0 border-input bg-muted text-muted-foreground text-sm font-medium">
                          app.platform.com/
                        </span>
                        <Input
                          placeholder="acme-corp"
                          className="h-12 rounded-l-none"
                          {...field}
                        />
                      </div>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <Button
                type="submit"
                className="w-full h-12 text-base"
                disabled={
                  isPending ||
                  !auth.csrfReady ||
                  !auth.csrfToken ||
                  !turnstile.canSubmit
                }
              >
                {isPending ? (
                  "Creating..."
                ) : (
                  <>
                    Continue to Dashboard{" "}
                    <ArrowRight className="ml-2 w-4 h-4" />
                  </>
                )}
              </Button>
              {turnstile.enabled && (
                <div className="mt-6 space-y-2">
                  <turnstile.TurnstileWidget />
                  {turnstile.guidanceMessage && (
                    <p
                      className={`text-sm ${turnstile.status === "error" || turnstile.status === "expired" ? "text-destructive" : "text-muted-foreground"}`}
                    >
                      {turnstile.guidanceMessage}
                    </p>
                  )}
                </div>
              )}
            </form>
          </Form>
        </Card>
      </AuthFormMotion>
    </AuthShell>
  );
}

export default function Onboarding() {
  return (
    <AuthI18nProvider>
      <OnboardingContent />
    </AuthI18nProvider>
  );
}
