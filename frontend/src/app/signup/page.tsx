"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { SiteLogo } from "@/app/components/site-logo";

export default function SignupPage() {
    const router = useRouter();

    useEffect(() => {
        router.replace("/login");
    }, [router]);

    return (
        <div className="min-h-dvh bg-gray-50/80 flex items-start justify-center px-6 pt-32 md:pt-40 pb-10 relative">
            <div className="absolute top-4 md:top-8 left-1/2 -translate-x-1/2">
                <SiteLogo size="lg" asLink />
            </div>
            <div className="w-full max-w-md">
                <div className="rounded-2xl border border-white/70 bg-white/72 p-10 text-center shadow-sm backdrop-blur-2xl">
                    <h2 className="text-2xl font-medium font-serif text-gray-950 mb-3">
                        Sign Up Unavailable
                    </h2>
                    <p className="text-gray-600 leading-relaxed">
                        Account creation is managed by administrators.
                        Please contact your administrator for access.
                    </p>
                    <button
                        onClick={() => router.push("/login")}
                        className="mt-6 rounded-lg bg-black px-4 py-2 text-sm font-medium text-white hover:bg-gray-800"
                    >
                        Go to Login
                    </button>
                </div>
            </div>
        </div>
    );
}
