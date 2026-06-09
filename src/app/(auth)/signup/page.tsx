import type { Metadata } from "next";
import { AuthForm } from "@/components/auth/auth-form";

export const metadata: Metadata = {
  title: "Sign Up",
  description: "Create a free Tarjuman account to transcribe and translate Arabic khutbahs and lectures in real time.",
};

export default function SignupPage() {
  return <AuthForm mode="signUp" />;
}
