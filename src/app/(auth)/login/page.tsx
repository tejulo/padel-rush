import { LoginForm } from '@/components/auth/login-form'
import { SiteBanner } from '@/components/site-banner'

export default function LoginPage() {
  return (
    <>
      <SiteBanner />
      <main className="site-main login-main stack">
        <h1 className="eyebrow tint-olive">Padel Rush</h1>
        <div className="cta-block-red">
          <p>Inicia sesion para gestionar tus torneos.</p>
        </div>
        <LoginForm />
      </main>
    </>
  )
}
