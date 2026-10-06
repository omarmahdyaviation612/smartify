// The 27 Egyptian governorates — a fixed, deterministic list (never
// sourced from Google or any external provider). Codes MUST stay in sync
// with EGYPT_GOVERNORATE_CODES in packages/validation/src/index.ts, which
// is what the backend actually validates against; this file only supplies
// bilingual display labels for the same fixed codes.

export interface Governorate {
  code: string;
  nameEn: string;
  nameAr: string;
}

export const EGYPT_GOVERNORATES: Governorate[] = [
  { code: "CAIRO", nameEn: "Cairo", nameAr: "القاهرة" },
  { code: "ALEXANDRIA", nameEn: "Alexandria", nameAr: "الإسكندرية" },
  { code: "GIZA", nameEn: "Giza", nameAr: "الجيزة" },
  { code: "QALYUBIA", nameEn: "Qalyubia", nameAr: "القليوبية" },
  { code: "PORT_SAID", nameEn: "Port Said", nameAr: "بورسعيد" },
  { code: "SUEZ", nameEn: "Suez", nameAr: "السويس" },
  { code: "DAKAHLIA", nameEn: "Dakahlia", nameAr: "الدقهلية" },
  { code: "SHARQIA", nameEn: "Sharqia", nameAr: "الشرقية" },
  { code: "GHARBIA", nameEn: "Gharbia", nameAr: "الغربية" },
  { code: "MONUFIA", nameEn: "Monufia", nameAr: "المنوفية" },
  { code: "BEHEIRA", nameEn: "Beheira", nameAr: "البحيرة" },
  { code: "KAFR_EL_SHEIKH", nameEn: "Kafr El Sheikh", nameAr: "كفر الشيخ" },
  { code: "DAMIETTA", nameEn: "Damietta", nameAr: "دمياط" },
  { code: "ISMAILIA", nameEn: "Ismailia", nameAr: "الإسماعيلية" },
  { code: "FAYOUM", nameEn: "Fayoum", nameAr: "الفيوم" },
  { code: "BENI_SUEF", nameEn: "Beni Suef", nameAr: "بني سويف" },
  { code: "MINYA", nameEn: "Minya", nameAr: "المنيا" },
  { code: "ASYUT", nameEn: "Asyut", nameAr: "أسيوط" },
  { code: "SOHAG", nameEn: "Sohag", nameAr: "سوهاج" },
  { code: "QENA", nameEn: "Qena", nameAr: "قنا" },
  { code: "LUXOR", nameEn: "Luxor", nameAr: "الأقصر" },
  { code: "ASWAN", nameEn: "Aswan", nameAr: "أسوان" },
  { code: "RED_SEA", nameEn: "Red Sea", nameAr: "البحر الأحمر" },
  { code: "NEW_VALLEY", nameEn: "New Valley", nameAr: "الوادي الجديد" },
  { code: "MATROUH", nameEn: "Matrouh", nameAr: "مطروح" },
  { code: "NORTH_SINAI", nameEn: "North Sinai", nameAr: "شمال سيناء" },
  { code: "SOUTH_SINAI", nameEn: "South Sinai", nameAr: "جنوب سيناء" },
];
