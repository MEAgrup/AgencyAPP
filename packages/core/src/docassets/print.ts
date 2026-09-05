/**
 * Tombol PDF dokumen laporan — Print browser, nol pustaka dari CDN.
 *
 * MENGGANTIKAN `PDF_BOOT` (html2pdf 0.10.1 dari cdnjs), yang punya satu mode
 * gagal yang sangat buruk untuk laporan yang sudah dikirim ke klien: kalau
 * pustakanya tidak termuat, `PDF_BOOT` MENYEMBUNYIKAN tombolnya
 * (`b.style.display='none'`). Klien membuka berkasnya, tidak melihat tombol apa
 * pun, dan menyimpulkan laporan MEA memang tidak bisa disimpan sebagai PDF —
 * nol pesan galat, nol cara tahu bahwa yang rusak adalah jaringannya.
 *
 * `window.print()` selalu ada. Tombolnya tidak bisa menghilang lagi.
 *
 * NAMA BERKAS. Dialog Print memakai `document.title` sebagai nama berkas usulan,
 * jadi judul ditukar sebentar ke `window.REPORT_PDF_NAME` (hasil `pdfName()`,
 * termasuk sufiks `-INTERNAL`) dan dikembalikan setelah dialog tutup. Ditukar
 * lewat `beforeprint`/`afterprint`, BUKAN cuma di dalam handler klik: label
 * tombolnya mengiklankan Ctrl+P, dan Ctrl+P tidak pernah melewati handler klik.
 * Handler klik tetap ada supaya browser tanpa `beforeprint` tetap dapat nama
 * yang benar.
 */
export const PRINT_BOOT = `
(function(){
 var doc=document, judulAsli=doc.title;
 function nama(){ return window.REPORT_PDF_NAME || judulAsli; }
 function pasang(){ doc.title=nama(); }
 function lepas(){ doc.title=judulAsli; }
 if(window.addEventListener){
  window.addEventListener('beforeprint',pasang);
  window.addEventListener('afterprint',lepas);
 }
 var b=doc.getElementById('btnPdf'); if(!b) return;
 b.addEventListener('click',function(){
  // Jaring untuk browser tanpa 'beforeprint'. Di browser yang punya, ini
  // idempoten: judulnya sudah/akan disetel ke nilai yang sama.
  pasang();
  try{ window.print(); } finally { setTimeout(lepas,0); }
 });
})();`;
