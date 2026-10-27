import { Brand } from '../PortalLayout';
import { usePortalAuth } from '../PortalAuth';

// The frame of the signed-out account pages (mockup AccountStates): brand on
// top, one centred card.
export default function AccountCard({ caption, title, children }) {
  const { config } = usePortalAuth();
  return (
    <div className="min-h-screen px-4 py-6 sm:py-12" style={{ backgroundColor: 'var(--color-bg)' }}>
      <div className="mx-auto flex max-w-[440px] flex-col gap-6">
        <Brand config={config} to="/portal/sign-in" />
        <div className="card flex flex-col gap-4 p-6 sm:p-7">
          {caption && <p className="eyebrow">{caption}</p>}
          <h1 className="text-xl font-semibold" style={{ color: 'var(--color-text-primary)' }}>{title}</h1>
          {children}
        </div>
      </div>
    </div>
  );
}
