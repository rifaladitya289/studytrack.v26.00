/* StudyTrack X — per-user cloud backup/sync for the existing local workspace.
 * Only the active account's scoped keys are transferred. Other accounts and global app data are excluded.
 */
const supabase = window.STX_SUPABASE;
if (supabase) {
  const nativeSetItem = Storage.prototype.setItem;
  const nativeRemoveItem = Storage.prototype.removeItem;
  let activeUserId = null;
  let restoring = false;
  let syncTimer = null;
  let syncBusy = false;
  let syncAgain = false;

  const marker = (uid, kind) => "__stx_cloud_" + kind + "_" + uid;
  const activeEmail = () => localStorage.getItem("stx_active_session") || "";
  const scopedPrefix = (email) => "__stx_user__" + encodeURIComponent(email) + "__";
  const showStatus = (message) => {
    if (typeof window.showToast === "function") window.showToast(message);
  };
  const accountStore = () => {
    try { return JSON.parse(localStorage.getItem("stx_database_accounts") || "{}") || {}; }
    catch (_) { return {}; }
  };
  const hasLocalWorkspace = (email) => {
    const prefix = scopedPrefix(email);
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith(prefix)) return true;
    }
    return false;
  };
  function makeSnapshot(email) {
    const prefix = scopedPrefix(email);
    const workspace = {};
    for (let i = 0; i < localStorage.length; i++) {
      const physicalKey = localStorage.key(i);
      if (!physicalKey || !physicalKey.startsWith(prefix)) continue;
      const logicalKey = physicalKey.slice(prefix.length);
      const value = localStorage.getItem(physicalKey);
      if (value !== null) workspace[logicalKey] = value;
    }
    const accounts = accountStore();
    const account = { ...(accounts[email] || {}) };
    delete account.password;
    // Images remain on-device until the private Storage upload flow is added.
    delete account.profilePhoto;
    delete account.barcodeImage;
    return { version: 1, email, account, workspace };
  }
  async function uploadSnapshot(uid, email) {
    const payload = makeSnapshot(email);
    const { data, error } = await supabase
      .from("user_state")
      .upsert({ user_id: uid, payload }, { onConflict: "user_id" })
      .select("updated_at")
      .single();
    if (error) throw error;
    localStorage.setItem(marker(uid, "last_sync"), data.updated_at);
    localStorage.removeItem(marker(uid, "dirty"));
    return data.updated_at;
  }
  function restoreSnapshot(uid, email, payload, updatedAt) {
    if (!payload || payload.version !== 1 || payload.email !== email || !payload.workspace || typeof payload.workspace !== "object") {
      throw new Error("Cadangan cloud tidak memiliki format STX yang dikenali.");
    }
    restoring = true;
    try {
      const accounts = accountStore();
      const current = accounts[email] || {};
      const localPhoto = current.profilePhoto || "";
      const localBarcode = current.barcodeImage || "";
      accounts[email] = { ...current, ...payload.account, email };
      if (localPhoto) accounts[email].profilePhoto = localPhoto;
      if (localBarcode) accounts[email].barcodeImage = localBarcode;
      delete accounts[email].password;
      // Keep images already stored on this device; cloud image storage is a separate phase.
      writeAccountStore(accounts);
      Object.entries(payload.workspace).forEach(([key, value]) => {
        if (typeof key === "string" && key.startsWith("stx_") && typeof value === "string") {
          localStorage.setItem(key, value);
        }
      });
      localStorage.setItem(marker(uid, "last_sync"), updatedAt || new Date().toISOString());
      localStorage.removeItem(marker(uid, "dirty"));
    } finally {
      restoring = false;
    }
  }
  function writeAccountStore(accounts) {
    localStorage.setItem("stx_database_accounts", JSON.stringify(accounts));
  }
  async function syncActiveUser(user) {
    if (!user?.id || !user?.email) return;
    const uid = user.id;
    const email = user.email.toLowerCase();
    if (activeEmail().toLowerCase() !== email) return;
    if (syncBusy) { syncAgain = true; return; }
    syncBusy = true;
    activeUserId = uid;
    try {
      const { data: remote, error } = await supabase
        .from("user_state")
        .select("payload, updated_at")
        .eq("user_id", uid)
        .maybeSingle();
      if (error) throw error;

      const localHasData = hasLocalWorkspace(email);
      const lastSync = localStorage.getItem(marker(uid, "last_sync"));
      const dirty = localStorage.getItem(marker(uid, "dirty")) === "1";

      if (remote && !localHasData) {
        restoreSnapshot(uid, email, remote.payload, remote.updated_at);
        if (typeof window.renderAllData === "function") window.renderAllData();
        showStatus("Data STX berhasil dipulihkan dari cloud.");
      } else if (remote && lastSync && Date.parse(remote.updated_at) > Date.parse(lastSync) && dirty) {
        showStatus("Ada perubahan STX dari perangkat lain. Data lokal dipertahankan; sinkronisasi otomatis dijeda agar tidak menimpa data.");
      } else if (remote && lastSync && Date.parse(remote.updated_at) > Date.parse(lastSync) && !dirty) {
        restoreSnapshot(uid, email, remote.payload, remote.updated_at);
        if (typeof window.renderAllData === "function") window.renderAllData();
        showStatus("Data STX diperbarui dari cloud.");
      } else if (!remote || dirty || !lastSync) {
        await uploadSnapshot(uid, email);
        showStatus("Cadangan data STX berhasil disinkronkan.");
      }
      window.STX_CLOUD_SYNC_STATUS = { userId: uid, lastSync: localStorage.getItem(marker(uid, "last_sync")), dirty: localStorage.getItem(marker(uid, "dirty")) === "1" };
    } catch (error) {
      console.error("STX cloud sync:", error);
      window.STX_CLOUD_SYNC_STATUS = { userId: uid, error: String(error?.message || error) };
      showStatus("Cadangan cloud belum tersinkron: " + String(error?.message || "periksa koneksi"));
    } finally {
      syncBusy = false;
      if (syncAgain) {
        syncAgain = false;
        scheduleSync();
      }
    }
  }
  function scheduleSync() {
    if (!activeUserId || restoring || activeEmail().toLowerCase() === "") return;
    localStorage.setItem(marker(activeUserId, "dirty"), "1");
    clearTimeout(syncTimer);
    syncTimer = setTimeout(() => {
      supabase.auth.getUser().then(({ data: result, error }) => {
        if (!error && result?.user) return syncActiveUser(result.user);
      }).catch((error) => console.error("STX scheduled sync:", error));
    }, 1800);
  }

  Storage.prototype.setItem = function (key, value) {
    const result = nativeSetItem.call(this, key, value);
    if (this === localStorage && (String(key).startsWith("stx_")) && activeUserId && !restoring) scheduleSync();
    return result;
  };
  Storage.prototype.removeItem = function (key) {
    const result = nativeRemoveItem.call(this, key);
    if (this === localStorage && String(key).startsWith("stx_") && activeUserId && !restoring) scheduleSync();
    return result;
  };

  // Supabase callbacks stay synchronous; the actual network work is queued separately.
  window.addEventListener("load", () => {
    setTimeout(() => {
      supabase.auth.getUser().then(({ data, error }) => {
        if (!error && data?.user) syncActiveUser(data.user);
      }).catch((error) => console.error("STX initial cloud sync:", error));
    }, 1400);
  });

  supabase.auth.onAuthStateChange((event, session) => {
    if (session?.user) {
      const uid = session.user.id;
      setTimeout(() => {
        if (activeEmail().toLowerCase() === String(session.user.email || "").toLowerCase()) {
          syncActiveUser(session.user);
        } else {
          activeUserId = uid;
        }
      }, 900);
    } else if (event === "SIGNED_OUT") {
      activeUserId = null;
      clearTimeout(syncTimer);
    }
  });
  window.STX_CLOUD_SYNC = { syncNow: () => supabase.auth.getUser().then(({ data, error }) => {
    if (error) throw error;
    return syncActiveUser(data.user);
  }) };
}
