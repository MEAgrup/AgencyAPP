'use client';

import { useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';
import { navFeatureOf, navTotalFor } from '@/lib/nav';
import { sendPageView } from '@/lib/adopsi';
import type { Role } from '@/lib/types';

/**
 * Adopsi Sistem (pemilik 2026-09-10, Bagian 1) — satu baris log per
 * perpindahan rute. Nol UI: ia dirender di lapisan shell dan tidak pernah
 * menampilkan apa pun.
 *
 * ── Tiga hal yang dijaga di sini, dan ketiganya pernah salah di tempat lain ─
 *
 *  1. **Nol render.** Ia mengembalikan `null`. Sebuah pelacak yang merender
 *     apa pun ikut memindahkan tata letak halaman yang diukurnya.
 *  2. **Satu baris per rute, bukan per render.** React memanggil efek lagi
 *     pada setiap re-render yang mengubah dependensinya; `lastRef` membuat
 *     rute yang sama tidak pernah dilaporkan dua kali berturut-turut. Tanpa
 *     itu, "Page View" mengukur jumlah render, bukan jumlah kunjungan — angka
 *     yang lebih besar dan tidak berarti apa-apa.
 *  3. **`role` ikut jadi kunci.** `navTotalFor(role)` adalah PENYEBUT cakupan
 *     fitur; kalau peran belum termuat (`null` saat `useAuth` masih memuat),
 *     penyebutnya 0 dan barisnya membuang informasi. Karena itu ia MENUNGGU
 *     peran ada sebelum melapor — satu rute tetap satu baris, hanya sedikit
 *     lebih lambat.
 *
 * Galat sengaja ditelan di `sendPageView`: log pemakaian tidak pernah boleh
 * merusak halaman yang memanggilnya.
 */
export default function AdopsiTracker({ role }: { role: Role | null }) {
  const pathname = usePathname();
  const lastRef = useRef<string | null>(null);

  useEffect(() => {
    if (role === null) return;
    if (pathname === null) return;
    if (lastRef.current === pathname) return;
    lastRef.current = pathname;
    void sendPageView({
      path: pathname,
      nav_href: navFeatureOf(role, pathname),
      nav_total: navTotalFor(role),
    });
  }, [pathname, role]);

  return null;
}
