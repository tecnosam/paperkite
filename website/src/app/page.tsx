import { Hero } from '@/components/home/Hero';
import { HowItWorks } from '@/components/home/HowItWorks';
import { FeatureGrid } from '@/components/home/FeatureGrid';
import { AgentsSection } from '@/components/home/AgentsSection';
import { PrivateServersSection } from '@/components/home/PrivateServersSection';
import { DevStrip } from '@/components/home/DevStrip';
import { CTASection } from '@/components/home/CTASection';

export default function Home() {
  return (
    <main>
      <Hero />
      <HowItWorks />
      <FeatureGrid />
      <AgentsSection />
      <PrivateServersSection />
      <DevStrip />
      <CTASection />
    </main>
  );
}
