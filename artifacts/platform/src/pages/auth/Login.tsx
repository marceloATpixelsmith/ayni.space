import React from "react";
import { Link, useLocation } from "wouter";
import { motion } from "framer-motion";
import { useGetGoogleAuthUrl, useGetMe } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Chrome, ActivitySquare } from "lucide-react";

export default function Login() {
  const [, setLocation] = useLocation();
  const { data: user, isLoading } = useGetMe({ query: { retry: false } });
  const { data: authUrl, isLoading: isUrlLoading } = useGetGoogleAuthUrl();

  React.useEffect(() => {
    if (user) {
      setLocation("/dashboard");
    }
  }, [user, setLocation]);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <ActivitySquare className="w-10 h-10 text-primary animate-pulse" />
      </div>
    );
  }

  const handleGoogleLogin = () => {
    if (authUrl?.url) {
      window.location.href = authUrl.url;
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center relative bg-slate-50 dark:bg-slate-950 overflow-hidden">
      {/* Background Image */}
      <div className="absolute inset-0 z-0">
        <img 
          src={`${import.meta.env.BASE_URL}images/auth-bg.png`} 
          alt="Abstract background" 
          className="w-full h-full object-cover opacity-60 mix-blend-multiply"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-background via-background/80 to-transparent" />
      </div>

      <div className="relative z-10 w-full max-w-md p-6">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: "easeOut" }}
        >
          <div className="flex justify-center mb-8">
            <img 
              src={`${import.meta.env.BASE_URL}images/logo.png`} 
              alt="Logo" 
              className="w-16 h-16 object-contain drop-shadow-xl"
            />
          </div>

          <Card className="p-8 backdrop-blur-xl bg-card/90 border-white/20 shadow-2xl shadow-primary/5">
            <div className="text-center mb-8">
              <h1 className="text-3xl font-bold tracking-tight text-foreground mb-2">Welcome Back</h1>
              <p className="text-muted-foreground">Sign in to access your tenant dashboard and applications.</p>
            </div>

            <Button 
              size="lg" 
              className="w-full h-12 text-base font-medium shadow-md transition-all group"
              onClick={handleGoogleLogin}
              disabled={isUrlLoading}
            >
              <Chrome className="w-5 h-5 mr-3 group-hover:scale-110 transition-transform" />
              Sign in with Google
            </Button>

            <div className="mt-8 text-center text-sm text-muted-foreground">
              By signing in, you agree to our{" "}
              <a href="#" className="underline hover:text-primary transition-colors">Terms of Service</a>{" "}
              and{" "}
              <a href="#" className="underline hover:text-primary transition-colors">Privacy Policy</a>.
            </div>
          </Card>
        </motion.div>
      </div>
    </div>
  );
}
