'use client';

import { use } from 'react';
import Link from 'next/link';
import { getEmbeddedTool } from '@/lib/embedded-tools';

/**
 * Generic host page for an embedded HTML tool (see `@/lib/embedded-tools`).
 *
 * The tool is a self-contained, first-party static asset under `public/tools/`.
 * It is loaded in an iframe and computes everything client-side from files the
 * user drops in — it makes NO CDPS API calls. CDPS ingests the payload it emits
 * separately (DECISIONS.md 2026-08-21). Because it is our own same-origin
 * content that relies on clipboard, blob downloads, `confirm()` and
 * `target="_blank"` links, it is not sandboxed; `allow="clipboard-write"` lets
 * its "Copy …" buttons work without falling back to the manual-copy modal.
 */
export default function EmbeddedToolPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params);
  const tool = getEmbeddedTool(slug);

  if (!tool) {
    return (
      <div>
        <h1>Alat tidak ditemukan</h1>
        <p>
          Tidak ada alat terdaftar dengan kode <code>{slug}</code>.{' '}
          <Link href="/">Kembali ke dashboard</Link>.
        </p>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div>
        <h1>{tool.title}</h1>
        <p style={{ margin: '6px 0 0', color: '#5A7184', maxWidth: 820 }}>{tool.tagline}</p>
        <p style={{ margin: '4px 0 0', color: '#8697A6', fontSize: 12 }}>
          Untuk: {tool.audience}
        </p>
      </div>
      <iframe
        title={tool.title}
        src={tool.asset}
        allow="clipboard-write"
        style={{
          width: '100%',
          height: 'calc(100vh - 180px)',
          minHeight: 640,
          border: '1px solid #DAE2EA',
          borderRadius: 4,
          background: '#EDF1F5',
        }}
      />
    </div>
  );
}
