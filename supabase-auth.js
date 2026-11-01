/* StudyTrack X — Supabase Auth bridge.
 * Auth credentials are handled only by Supabase Auth.
 * Existing local workspace data remains in place; this bridge does not bulk-upload or delete it.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.118.0";

const STX_SUPABASE_URL = "https://emmecivxkbvwrkqaltzo.supabase.co";
const STX_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_nDUvfBg8TieuvI1I-sIjaw_B8-UbqZ3";
const supabase = createClient(STX_SUPABASE_URL, STX_SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    storage: window.localStorage
  }
});
window.STX_SUPABASE = supabase;

// Keep other open tabs from continuing to show a signed-in workspace after logout.
supabase.auth.onAuthStateChange((event) => {
  if (event === "SIGNED_OUT") {
    localStorage.removeItem("stx_active_session");
    if (typeof window.showPage === "function") window.showPage("loginPage");
  }
});

const $ = (id) => document.getElementById(id);
const readAccounts = () => {
  try { return JSON.parse(localStorage.getItem("stx_database_accounts") || "{}") || {}; }
  catch (_) { return {}; }
};
const writeAccounts = (accounts) => localStorage.setItem("stx_database_accounts", JSON.stringify(accounts));
function makeLocalAccount(user, existing, metadata) {
  const meta = user?.user_metadata || metadata || {};
  const name = existing?.namaAsli || meta.display_name || meta.full_name || meta.name || "";
  const account = {
    ...(existing || {}),
    namaAsli: name,
    namaSamaran: existing?.namaSamaran || name,
    email: user.email || existing?.email || "",
    bio: existing?.bio || "",
    tempatLahir: existing?.tempatLahir || "",
    tanggalLahir: existing?.tanggalLahir || "",
    jenisKelamin: existing?.jenisKelamin || "",
    jurusan: existing?.jurusan || "PPLG",
    kelas: existing?.kelas || meta.class_name || "",
    sekolah: existing?.sekolah || "SMKN 1 Ciamis",
    organisasi: existing?.organisasi || meta.organization || "",
    profilePhoto: existing?.profilePhoto || "",
    barcodeImage: existing?.barcodeImage || "",
    attendance: Array.isArray(existing?.attendance) ? existing.attendance : [],
    coins: Number.isFinite(existing?.coins) ? existing.coins : 0,
    unlockedBorders: Array.isArray(existing?.unlockedBorders) ? existing.unlockedBorders : ["default"],
    equippedBorder: existing?.equippedBorder || "default",
    claimedWelcomeReward: existing?.claimedWelcomeReward ?? false,
    hasSeenTutorial: existing?.hasSeenTutorial ?? false,
    workspaceInitialized: existing?.workspaceInitialized === true
  };
  // Preserve any additional legacy account fields, but never retain a plaintext password.
  delete account.password;
  return account;
}
function enterApp(user, metadata) {
  const email = String(user?.email || "").trim().toLowerCase();
  if (!email) throw new Error("Google tidak mengembalikan alamat email.");
  const accounts = readAccounts();
  const existed = !!accounts[email];
  const previous = accounts[email] || null;
  const wasLegacyAccount = !!previous && previous.workspaceInitialized !== true;
  accounts[email] = makeLocalAccount(user, previous, metadata);
  writeAccounts(accounts);
  localStorage.setItem("stx_active_session", email);
  if (typeof window.STX_INIT_USER_WORKSPACE === "function") {
    window.STX_INIT_USER_WORKSPACE(email, wasLegacyAccount);
  }
  accounts[email].workspaceInitialized = true;
  writeAccounts(accounts);
  if (typeof window.renderAllData === "function") window.renderAllData();
  if (typeof window.switchTab === "function") window.switchTab("beranda");
  if (!existed && typeof window.showToast === "function") window.showToast("Akun Google berhasil terhubung ke StudyTrack X.");
  if (!accounts[email].hasSeenTutorial) {
    const tutorial = $("tutorialModal");
    if (tutorial) tutorial.classList.add("active");
    accounts[email].hasSeenTutorial = true;
    writeAccounts(accounts);
  }
}
window.signInWithGoogle = async function () {
  const button = $("googleLoginBtn");
  const errorBox = $("googleLoginError");
  if (button) { button.disabled = true; button.textContent = "Menghubungkan Google..."; }
  if (errorBox) { errorBox.textContent = ""; errorBox.style.display = "none"; }
  try {
    const redirectTo = window.location.origin + window.location.pathname;
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo, queryParams: { prompt: "select_account" } }
    });
    if (error) throw error;
  } catch (error) {
    const message = String(error?.message || "Login Google gagal dimulai.");
    if (errorBox) { errorBox.textContent = message; errorBox.style.display = "block"; }
    else if (typeof window.showToast === "function") window.showToast(message);
    if (button) { button.disabled = false; button.textContent = "Lanjutkan dengan Google"; }
  }
};

window.logoutSession = async function () {
  if (typeof window.closeDrawer === "function") window.closeDrawer();
  const { error } = await supabase.auth.signOut({ scope: "local" });
  if (error) {
    if (typeof window.showToast === "function") window.showToast("Logout belum berhasil: " + error.message);
    return;
  }
  localStorage.removeItem("stx_active_session");
  clearAuthFields();
  if (typeof window.showPage === "function") window.showPage("loginPage");
  if (typeof window.showToast === "function") window.showToast("Keluar sesi berhasil.");
};

// Restore Supabase session after the legacy startup handler has finished showing login.
window.addEventListener("load", async () => {
  try {
    const { data, error } = await supabase.auth.getSession();
    if (error) throw error;
    if (data.session?.user) {
      enterApp(data.session.user);
    } else {
      localStorage.removeItem("stx_active_session");
      if (typeof window.showPage === "function") window.showPage("loginPage");
    }
  } catch (error) {
    console.error("STX Google session restore:", error);
    localStorage.removeItem("stx_active_session");
    if (typeof window.showPage === "function") window.showPage("loginPage");
    if (typeof window.showToast === "function") window.showToast("Tidak dapat memulihkan sesi Google. Periksa koneksi internet.");
  }
});
