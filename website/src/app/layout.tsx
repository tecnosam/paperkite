import type { Metadata } from 'next';
import './globals.css';
import { ThemeScript } from '@/components/ThemeScript';
import { Navbar } from '@/components/Navbar';
import { Footer } from '@/components/Footer';

export const metadata: Metadata = {
  title: 'Paperkite: the browser with a room for every page',
  description:
    'Paperkite is an open-source browser where anyone viewing the same webpage can chat in real time, bring their own AI agents, and run their own private chat server.',
};

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="en">
      <head>
        <ThemeScript />
      </head>
      <body>
        <Navbar />
        {children}
        <Footer />
      </body>
    </html>
  );
}
