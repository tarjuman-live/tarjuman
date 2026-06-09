import type { Metadata } from "next";
import { AuthForm } from "@/components/auth/auth-form";

export const metadata: Metadata = {
  title: "Log In",
  description: "Log in to Tarjuman to record, transcribe, and translate khutbahs and lectures.",
};

export default function LoginPage() {
  return <AuthForm mode="signIn" />;
}
