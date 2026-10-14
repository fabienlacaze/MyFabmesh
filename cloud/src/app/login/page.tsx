import { LoginForm } from './LoginForm';
import { T } from '@/lib/langue';

export default function LoginPage() {
  return (
    <div className="page" style={{ maxWidth: 460 }}>
      <h2 style={{ textAlign: 'center', marginBottom: 8 }}><T en="Welcome back" fr="Bon retour parmi nous" /></h2>
      <p style={{ textAlign: 'center', color: 'var(--text-2)', fontSize: 13, marginBottom: 24 }}>
        <T
          en="Sign in with your email and password to access your Cloud workspace."
          fr="Connectez-vous avec votre e-mail et votre mot de passe pour accéder à votre espace Cloud."
        />
      </p>
      <div className="card">
        <LoginForm />
      </div>
      <p style={{ textAlign: 'center', color: 'var(--text-3)', fontSize: 12, marginTop: 16 }}>
        <T
          en="New here? Click **Create an account** to sign up with your email and a password."
          fr="Nouveau ici ? Cliquez sur **Créer un compte** pour vous inscrire avec votre e-mail et un mot de passe."
        />
      </p>
    </div>
  );
}
