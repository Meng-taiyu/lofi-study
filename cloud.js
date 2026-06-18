"use strict";

/* =========================================================================
   夜间自习室 · cloud.js —— Supabase 云端同步
   - 邮箱+密码登录/注册
   - 番茄计数(按天)、番茄钟预设、音量/开关 跨设备同步
   依赖:vendor/supabase.js(全局 window.supabase),需在本文件之前加载。
   暴露 window.Cloud,被 app.js 调用。

   说明:这里的 publishable key 是"可公开"密钥,放进前端是 Supabase 的预期用法,
   真正的数据安全由数据库"行级安全(RLS)"保证——每个用户只能读写自己的数据。
   ========================================================================= */
(function () {
  const SUPABASE_URL = "https://evotyptzowoshdaualsc.supabase.co";
  const SUPABASE_KEY = "sb_publishable_jy6umWtcf90qori68pj93Q_fzbSJb0E";

  const Cloud = {
    enabled: false,
    client: null,
    user: null,

    init() {
      if (!window.supabase || !window.supabase.createClient) return false;
      this.client = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
      this.enabled = true;
      return true;
    },

    onChange(cb) {
      if (!this.enabled) return;
      this.client.auth.onAuthStateChange((_evt, session) => {
        this.user = session ? session.user : null;
        cb(this.user);
      });
    },

    async refreshUser() {
      if (!this.enabled) return null;
      const { data } = await this.client.auth.getSession();
      this.user = data && data.session ? data.session.user : null;
      return this.user;
    },

    async signUp(email, password) {
      return this.client.auth.signUp({ email, password });
    },
    async signIn(email, password) {
      return this.client.auth.signInWithPassword({ email, password });
    },
    async signOut() {
      await this.client.auth.signOut();
      this.user = null;
    },

    // 读取:今日番茄 + 用户设置
    async load(today) {
      if (!this.enabled || !this.user) return null;
      const uid = this.user.id;
      try {
        const [d, s] = await Promise.all([
          this.client.from("pomodoro_daily")
            .select("count").eq("user_id", uid).eq("day", today).maybeSingle(),
          this.client.from("user_settings")
            .select("focus_min,break_min,music_vol,rain_vol,music_on,rain_on")
            .eq("user_id", uid).maybeSingle(),
        ]);
        return { count: d.data ? d.data.count : 0, settings: s.data || null };
      } catch (e) {
        console.warn("云端读取失败:", e);
        return null;
      }
    },

    async saveDaily(today, count) {
      if (!this.enabled || !this.user) return;
      try {
        await this.client.from("pomodoro_daily").upsert(
          { user_id: this.user.id, day: today, count: count, updated_at: new Date().toISOString() },
          { onConflict: "user_id,day" }
        );
      } catch (e) { console.warn("云端存番茄失败:", e); }
    },

    async saveSettings(s) {
      if (!this.enabled || !this.user) return;
      try {
        await this.client.from("user_settings").upsert(
          Object.assign({ user_id: this.user.id, updated_at: new Date().toISOString() }, s),
          { onConflict: "user_id" }
        );
      } catch (e) { console.warn("云端存设置失败:", e); }
    },

    // —— 待办任务 ——
    async listTasks() {
      if (!this.enabled || !this.user) return [];
      try {
        const { data } = await this.client.from("tasks")
          .select("id,title,done").eq("user_id", this.user.id)
          .order("done", { ascending: true })
          .order("created_at", { ascending: true });
        return data || [];
      } catch (e) { console.warn("云端读任务失败:", e); return []; }
    },
    async addTask(title) {
      if (!this.enabled || !this.user) return null;
      try {
        const { data } = await this.client.from("tasks")
          .insert({ user_id: this.user.id, title: title })
          .select("id,title,done").single();
        return data;
      } catch (e) { console.warn("云端加任务失败:", e); return null; }
    },
    async setTaskDone(id, done) {
      if (!this.enabled || !this.user) return;
      try {
        await this.client.from("tasks")
          .update({ done: done, done_at: done ? new Date().toISOString() : null })
          .eq("id", id);
      } catch (e) { console.warn("云端更新任务失败:", e); }
    },
    async deleteTask(id) {
      if (!this.enabled || !this.user) return;
      try {
        await this.client.from("tasks").delete().eq("id", id);
      } catch (e) { console.warn("云端删任务失败:", e); }
    },
  };

  window.Cloud = Cloud;
})();
