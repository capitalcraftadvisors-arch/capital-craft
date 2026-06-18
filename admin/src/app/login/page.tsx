import LoginForm from "@/components/LoginForm";
import Card from "@/components/ui/Card";

export default function LoginPage() {
  return (
    <main className="min-h-screen bg-bg-soft">
      {/* Top brand bar (mirrors the marketing site header treatment) */}
      <header className="border-b border-line bg-white">
        <div className="max-w-container mx-auto px-7 h-16 flex items-center">
          <a href="https://www.capitalcraft.in" className="font-display font-bold text-[20px] grad-text">
            Capital Craft
          </a>
        </div>
      </header>

      <section className="max-w-container mx-auto px-7 py-16 md:py-24 grid place-items-center">
        <div className="w-full max-w-[420px]">
          <div className="text-center mb-8">
            <span className="inline-block px-3.5 py-1.5 bg-blue-50 border border-blue/15 rounded-full text-[12px] font-bold tracking-wider text-blue uppercase">
              EPC Portal
            </span>
            <h1 className="font-display text-[28px] md:text-[34px] font-bold mt-4 leading-tight">
              Welcome to <span className="grad-text">Capital Craft</span>
            </h1>
            <p className="text-text-mid mt-2">
              Sign in with your mobile number to onboard or continue your application.
            </p>
          </div>

          <Card className="p-7">
            <LoginForm />
          </Card>

          <p className="text-center text-[12px] text-text-muted mt-6">
            By continuing you agree to Capital Craft&rsquo;s terms &amp; privacy policy.
          </p>
        </div>
      </section>
    </main>
  );
}
