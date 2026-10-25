import Platform from '@/components/platform';
import { isConfigured } from '@/lib/supabase';
export const dynamic = 'force-dynamic';
export default function Page() {
  return <Platform configured={isConfigured()} />;
}
