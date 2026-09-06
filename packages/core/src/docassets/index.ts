/**
 * Aset dokumen laporan — satu modul, dipakai KETIGA renderer.
 *
 * CR-12. Sebelum ini setiap dokumen laporan menarik lima hal dari internet saat
 * dibuka (Tailwind play CDN, Chart.js, html2pdf, FontAwesome, Google Fonts).
 * Konsekuensinya menyentuh persis pekerjaan yang laporan ini ada untuk itu:
 * berkas yang AM UNDUH LALU KIRIM KE KLIEN rusak begitu CDN tak terjangkau —
 * chart hilang, tata letak runtuh, ikon jadi kotak, tombol PDF mati diam-diam.
 * Jaringan kantor klien yang memblokir CDN, koneksi lambat, dan berkas dibuka
 * offline setelah diunduh — ketiganya kejadian normal, bukan kasus tepi.
 *
 * Modul ini tetap MURNI seperti tetangganya (`report/`, `baseline/`): nol DOM,
 * nol `fs`, nol jam sendiri. Semuanya konstanta string, sehingga renderer tetap
 * bisa diuji sebagai fungsi murni.
 *
 * Ia ada sebagai satu modul bersama, bukan tiga salinan di tiga renderer,
 * karena tiga salinan aturan yang sama adalah cara aturan itu mulai berbeda.
 */
export { DOC_CSS, FONT_JUDUL, FONT_TUBUH } from './css';
export { ATRIBUSI_IKON, ICON_NAMES, ICON_SVG, ikon, type IconName } from './icons';
export { CHART_JS, CHART_JS_SHA256, CHART_JS_VERSI } from './chartjs';
export { PRINT_BOOT } from './print';
