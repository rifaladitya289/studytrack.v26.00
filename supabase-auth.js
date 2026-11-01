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
    if (typeof window.renderSavedAccounts === "function") window.renderSavedAccounts();
    if (typeof window.autoFillLastAccount === "function") window.autoFillLastAccount();
  }
});

const $ = (id) => document.getElementById(id);
const readAccounts = () => {
  try { return JSON.parse(localStorage.getItem("stx_database_accounts") || "{}") || {}; }
  catch (_) { return {}; }
};
const writeAccounts = (accounts) => localStorage.setItem("stx_database_accounts", JSON.stringify(accounts));
const isRegisterScreen = () => {
  const field = $("registerNameField");
  return !!field && getComputedStyle(field).display !== "none";
};
function authMessage(message, field) {
  const target = $(field || "passwordError");
  if (target) { target.textContent = message; target.style.display = "block"; }
  else if (typeof window.showToast === "function") window.showToast(message);
}
function setBusy(busy) {
  const btn = $("googleLoginBtn");
  if (btn) { btn.disabled = busy; btn.style.opacity = busy ? "0.7" : "1"; btn.textContent = busy ? "Menghubungkan Google..." : "Lanjutkan dengan Google"; }
}
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
  if (!email) throw new Error("Akun Supabase tidak mengembalikan alamat email.");
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
  if (!existed && typeof window.showToast === "function") window.showToast("Akun STX siap digunakan. Data belajar dimulai dari kosong.");
  if (!accounts[email].hasSeenTutorial) {
    const tutorial = $("tutorialModal");
    if (tutorial) tutorial.classList.add("active");
    accounts[email].hasSeenTutorial = true;
    writeAccounts(accounts);
  }
}
function clearAuthFields() {
  const p = $("authPasswordInput");
  if (p) p.value = "";
}
async function migrateLegacyAccount(email, password, oldAccount) {
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      emailRedirectTo: window.location.origin + window.location.pathname,
      data: {
        display_name: oldAccount.namaAsli || oldAccount.namaSamaran || "",
        class_name: oldAccount.kelas || "",
        organization: oldAccount.organisasi || ""
      }
    }
  });
  if (error) throw error;
  if (!data.session || !data.user) {
    throw new Error("Akun lama sedang dipindahkan. Buka email verifikasi Supabase, lalu masuk kembali. Password lama belum dihapus sampai login berhasil.");
  }
  return data.user;
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

window.handleAuthSubmit = async function (event) {
  event.preventDefault();
  if (typeof window.clearErrors === "function") window.clearErrors();
  const email = ($("authEmailInput")?.value || "").trim().toLowerCase();
  const password = $("authPasswordInput")?.value || "";
  const name = ($("regNameInput")?.value || "").trim();
  const className = ($("regClassInput")?.value || "").trim();
  const organization = ($("regOrgInput")?.value || "").trim();
  const accounts = readAccounts();
  const registering = isRegisterScreen();

  if (!email || !password) { authMessage("Email dan password wajib diisi.", "emailError"); return; }
  if (registering && !name) { authMessage("Nama lengkap wajib diisi!", "nameError"); return; }
  if (registering && !className) { authMessage("Kelas wajib diisi!", "classError"); return; }
  // A local legacy account is not the same as a Supabase Auth account.
  // Allow registration so its existing local workspace can be linked after email verification.
  setBusy(true);
  try {
    let user = null;
    if (registering) {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: window.location.origin + window.location.pathname,
          data: { display_name: name, class_name: className, organization }
        }
      });
      if (error) throw error;
      if (!data.session || !data.user) {
        clearAuthFields();
        if (typeof window.showToast === "function") window.showToast(accounts[email]
          ? "Registrasi diterima. Data lama di perangkat akan dipertahankan dan ditautkan setelah email diverifikasi. Periksa email, lalu masuk kembali."
          : "Registrasi diterima. Periksa email untuk verifikasi, lalu masuk kembali.");
        if (typeof window.toggleAuthMode === "function") window.toggleAuthMode();
        return;
      }
      user = data.user;
    } else {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) {
        const legacy = accounts[email];
        if (legacy && legacy.password && legacy.password === password) {
          user = await migrateLegacyAccount(email, password, legacy);
        } else {
          throw new Error("Email atau password tidak cocok. Jika akun lama, gunakan password yang sebelumnya dipakai pada perangkat ini.");
        }
      } else {
        user = data.user;
      }
    }
    enterApp(user, { display_name: name, class_name: className, organization });
    clearAuthFields();
    if (typeof window.showToast === "function") window.showToast("Berhasil masuk dengan Supabase.");
  } catch (error) {
    const message = String(error?.message || "Autentikasi gagal.");
    authMessage(message, message.toLowerCase().includes("email") ? "emailError" : "passwordError");
  } finally {
    setBusy(false);
  }
};

window.autoFillLastAccount = function () {
  const accounts = readAccounts();
  const emails = Object.keys(accounts);
  if (emails.length && $("authEmailInput")) $("authEmailInput").value = emails[emails.length - 1];
  clearAuthFields();
};
window.selectQuickAccount = function (email) {
  if ($("authEmailInput")) $("authEmailInput").value = email;
  clearAuthFields();
  if (typeof window.clearErrors === "function") window.clearErrors();
  if (typeof window.showToast === "function") window.showToast("Email akun dipilih. Masukkan password untuk melanjutkan.");
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
  if (typeof window.renderSavedAccounts === "function") window.renderSavedAccounts();
  if (typeof window.autoFillLastAccount === "function") window.autoFillLastAccount();
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
      if (typeof window.renderSavedAccounts === "function") window.renderSavedAccounts();
      if (typeof window.autoFillLastAccount === "function") window.autoFillLastAccount();
    }
  } catch (error) {
    console.error("STX Supabase session restore:", error);
    localStorage.removeItem("stx_active_session");
    if (typeof window.showPage === "function") window.showPage("loginPage");
    if (typeof window.showToast === "function") window.showToast("Tidak dapat memulihkan sesi. Periksa koneksi internet.");
  }
});
