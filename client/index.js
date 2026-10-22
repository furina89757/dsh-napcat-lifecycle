/**
 * dsh-napcat-lifecycle — client bundle.
 *
 * Registers a "NapCat" section in the Settings page. The panel shows the live
 * process state (read from the host service through ctx.napcatLifecycle), the
 * recent NapCat log tail, and three actions: start / stop / restart plus an
 * "open WebUI" button.
 *
 * "Open WebUI" deliberately opens a FULL-SCREEN modal instead of a right
 * sidebar Browser tab: the Settings page is itself a modal overlay, and the
 * sidebar is not interactive while it is open.
 *
 * Host loading contract (same shape as dsh-onebot's client bundle):
 *   - CJS wrapper: window.__ModuleLoader__.load({ id, factory: (require) => { ... } })
 *   - externals: react only (the platform-frozen module table)
 *   - exports.inject / exports.apply
 *   - panel registration: ctx.slots.inject('settings.section', () => ctx.slots.register(...))
 */

window.__ModuleLoader__.load({
	id: "dsh-napcat-lifecycle",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;

		var reactModule = require("react");
		var React = reactModule != null && typeof reactModule.createElement === "function"
			? reactModule
			: reactModule.default;
		if (React == null || typeof React.createElement !== "function") {
			throw new Error("dsh-napcat-lifecycle client: react 不可用");
		}

		var h = React.createElement;
		var PLUGIN_ID = "dsh-napcat-lifecycle";
		var REMOTE_NS = "napcatLifecycle";
		var NS = REMOTE_NS;

		//#region 词条
		var zh = {
			nav: "NapCat",
			title: "NapCat QQ 通道",
			desc: "管理 NapCat 进程：状态、日志、启停与 WebUI。",
			state: "运行状态",
			stateStarting: "启动中",
			stateRunning: "运行中",
			stateAwaitingLogin: "等待登录",
			stateStopped: "已停止",
			botQQ: "机器人 QQ",
			startedAt: "启动时间",
			restarts: "重启次数",
			loginFailure: "登录失败",
			lastExit: "上次退出",
			webui: "WebUI",
			recentLog: "最近日志",
			emptyLog: "（暂无输出）",
			openWebui: "打开 NapCat 面板",
			start: "启动",
			stop: "停止",
			restart: "重启",
			refresh: "刷新",
			working: "处理中…",
			close: "关闭",
			loginHint: "QQ 登录态已失效，需要扫码登录。点「打开 NapCat 面板」后扫码。",
			noService: "宿主未提供 napcatLifecycle 服务（插件未启用或未挂载）。",
			confirmStop: "确认停止 NapCat？停止后 QQ 通道会断开。",
			confirmRestart: "确认重启 NapCat？当前 QQ 连接会短暂断开。",
		};
		var en = {
			nav: "NapCat",
			title: "NapCat QQ channel",
			desc: "Manage the NapCat process: status, logs, start/stop and WebUI.",
			state: "Status",
			stateStarting: "Starting",
			stateRunning: "Running",
			stateAwaitingLogin: "Awaiting login",
			stateStopped: "Stopped",
			botQQ: "Bot QQ",
			startedAt: "Started at",
			restarts: "Restarts",
			loginFailure: "Login failure",
			lastExit: "Last exit",
			webui: "WebUI",
			recentLog: "Recent log",
			emptyLog: "(no output)",
			openWebui: "Open NapCat panel",
			start: "Start",
			stop: "Stop",
			restart: "Restart",
			refresh: "Refresh",
			working: "Working…",
			close: "Close",
			loginHint: "The QQ credential expired; scan the QR code. Click \"Open NapCat panel\" to scan.",
			noService: "The host does not expose the napcatLifecycle service (plugin disabled or not mounted).",
			confirmStop: "Stop NapCat? The QQ channel will disconnect.",
			confirmRestart: "Restart NapCat? The QQ connection drops briefly.",
		};
		//#endregion

		//#region 样式
		var CSS = [
			".nlc-wrap{display:flex;flex-direction:column;gap:14px;padding:4px 2px 24px;}",
			".nlc-card{border:1px solid var(--dsh-border,rgba(255,255,255,.12));border-radius:10px;padding:14px 16px;background:var(--dsh-surface,rgba(255,255,255,.03));}",
			".nlc-card h4{margin:0 0 10px;font-size:13px;font-weight:600;opacity:.85;}",
			".nlc-row{display:flex;gap:10px;align-items:baseline;font-size:13px;line-height:1.9;}",
			".nlc-row .k{min-width:88px;opacity:.6;}",
			".nlc-row .v{flex:1;word-break:break-all;}",
			".nlc-badge{display:inline-flex;align-items:center;gap:6px;padding:2px 10px;border-radius:999px;font-size:12px;font-weight:600;}",
			".nlc-badge .dot{width:7px;height:7px;border-radius:50%;background:currentColor;}",
			".nlc-running{background:rgba(34,197,94,.15);color:#22c55e;}",
			".nlc-starting{background:rgba(234,179,8,.15);color:#eab308;}",
			".nlc-awaiting{background:rgba(249,115,22,.15);color:#f97316;}",
			".nlc-stopped{background:rgba(148,163,184,.15);color:#94a3b8;}",
			".nlc-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px;}",
			".nlc-btn{appearance:none;border:1px solid var(--dsh-border,rgba(255,255,255,.16));background:var(--dsh-surface,rgba(255,255,255,.05));color:inherit;font:inherit;font-size:13px;padding:6px 14px;border-radius:8px;cursor:pointer;}",
			".nlc-btn:hover:not(:disabled){background:rgba(255,255,255,.1);}",
			".nlc-btn:disabled{opacity:.45;cursor:not-allowed;}",
			".nlc-btn.primary{background:#4f6bed;border-color:#4f6bed;color:#fff;}",
			".nlc-btn.primary:hover:not(:disabled){background:#4059d0;}",
			".nlc-hint{margin-top:10px;padding:10px 12px;border-radius:8px;background:rgba(249,115,22,.12);color:#f97316;font-size:12.5px;line-height:1.7;}",
			".nlc-log{margin:0;padding:10px 12px;border-radius:8px;background:rgba(0,0,0,.28);font-family:ui-monospace,Consolas,monospace;font-size:11.5px;line-height:1.65;white-space:pre-wrap;word-break:break-all;max-height:280px;overflow:auto;}",
			".nlc-err{margin-top:8px;color:#ef4444;font-size:12.5px;}",
			".nlc-modal-mask{position:fixed;inset:0;z-index:2147483000;background:rgba(0,0,0,.66);display:flex;align-items:center;justify-content:center;padding:28px;}",
			".nlc-modal{width:min(1180px,96vw);height:min(880px,90vh);display:flex;flex-direction:column;border-radius:14px;overflow:hidden;background:var(--dsh-bg,#15161a);border:1px solid var(--dsh-border,rgba(255,255,255,.14));box-shadow:0 24px 80px rgba(0,0,0,.55);}",
			".nlc-modal-head{display:flex;align-items:center;gap:12px;padding:10px 14px;border-bottom:1px solid var(--dsh-border,rgba(255,255,255,.1));}",
			".nlc-modal-head .t{flex:1;font-size:13px;font-weight:600;}",
			".nlc-modal-body{flex:1;min-height:0;background:#fff;}",
			".nlc-modal-body iframe{width:100%;height:100%;border:0;display:block;}",
		].join("\n");
		//#endregion


		//#region Remote 契约（与 host lib/settings-remote.js 的 NAMESPACE/CONFIG_KEYS 逐字对齐）
		function strictCodec(typeSymbol, schema) {
			return { mode: "strict", typeSymbol: typeSymbol, create: function () { return schema; }, schema: schema };
		}
		function jsonParameter(name, typeSymbol, schema) {
			return { name: name, wire: name, source: "json", codec: strictCodec(typeSymbol, schema) };
		}
		function napcatMethod(method, parameters, resultSchema, typeSymbol) {
			return {
				id: PLUGIN_ID + "#" + REMOTE_NS + "/" + method,
				service: REMOTE_NS,
				namespace: REMOTE_NS,
				method: method,
				invocation: { kind: "direct" },
				parameters: parameters,
				result: strictCodec(typeSymbol, resultSchema),
			};
		}
		/** 宽松 schema：结果由 host 侧组装，客户端只做透传（不重复校验）。 */
		var looseSchema = {
			parse: function (value) { return value; },
		};
		var actionSchema = {
			parse: function (value) {
				if (value === null || typeof value !== "object") throw new TypeError("expected object");
				return { ok: value.ok === true, message: typeof value.message === "string" ? value.message : "" };
			},
		};
		var configSnapshotSchema = {
			parse: function (value) {
				if (value === null || typeof value !== "object") throw new TypeError("expected object");
				return {
					revision: typeof value.revision === "number" ? value.revision : 0,
					entryActive: value.entryActive === true,
					config: value.config !== null && typeof value.config === "object" ? value.config : {},
					keys: Array.isArray(value.keys) ? value.keys : [],
				};
			},
		};
		var configPatchSchema = {
			parse: function (value) {
				if (value === null || typeof value !== "object" || Array.isArray(value)) throw new TypeError("expected object");
				return value;
			},
		};
		var NAPCAT_SETTINGS_DESCRIPTORS = [
			napcatMethod("getStatus", [], looseSchema, "LifecycleStatus"),
			napcatMethod("start", [], actionSchema, "ActionResult"),
			napcatMethod("stop", [], actionSchema, "ActionResult"),
			napcatMethod("restart", [], actionSchema, "ActionResult"),
			napcatMethod("getConfig", [], configSnapshotSchema, "ConfigSnapshot"),
			napcatMethod("updateConfig", [
				jsonParameter("patch", "ConfigPatch", configPatchSchema),
				{ name: "expectedRevision", wire: "expectedRevision", source: "json", codec: strictCodec("number", { parse: function (v) { return v === undefined || v === null ? undefined : v; } }) },
			], configSnapshotSchema, "ConfigSnapshot"),
		];
		var NAPCAT_SETTINGS_REMOTE = { package: PLUGIN_ID, descriptors: NAPCAT_SETTINGS_DESCRIPTORS };
		//#endregion

		//#region 工具
		function fmtTime(ms) {
			if (typeof ms !== "number" || ms <= 0) return "—";
			var d = new Date(ms);
			var p = function (n) { return String(n).padStart(2, "0"); };
			return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()) + " " + p(d.getHours()) + ":" + p(d.getMinutes()) + ":" + p(d.getSeconds());
		}

		function stateClass(state) {
			if (state === "running") return "nlc-running";
			if (state === "starting") return "nlc-starting";
			if (state === "awaiting-login") return "nlc-awaiting";
			return "nlc-stopped";
		}

		function stateLabel(t, state) {
			if (state === "running") return t("stateRunning");
			if (state === "starting") return t("stateStarting");
			if (state === "awaiting-login") return t("stateAwaitingLogin");
			return t("stateStopped");
		}
		//#endregion

		//#region WebUI 全屏弹窗
		/**
		 * Full-screen NapCat WebUI. Uses an iframe (the WebUI is a loopback HTTP
		 * page and renders fine inside one); the Settings page's own modal makes
		 * the right sidebar non-interactive, which is why this is a modal.
		 */
		function WebuiModal(props) {
			var url = props.url;
			var onClose = props.onClose;
			var t = props.t;
			React.useEffect(function () {
				var onKey = function (e) { if (e.key === "Escape") onClose(); };
				window.addEventListener("keydown", onKey);
				return function () { window.removeEventListener("keydown", onKey); };
			}, [onClose]);
			return h("div", {
				className: "nlc-modal-mask",
				role: "dialog",
				"aria-modal": "true",
				onMouseDown: function (e) { if (e.target === e.currentTarget) onClose(); },
			},
				h("div", { className: "nlc-modal" },
					h("div", { className: "nlc-modal-head" },
						h("span", { className: "t" }, "NapCat WebUI"),
						h("button", { className: "nlc-btn", type: "button", onClick: onClose }, t("close"))),
					h("div", { className: "nlc-modal-body" },
						h("iframe", { src: url, title: "NapCat WebUI", allow: "clipboard-write" }))));
		}
		//#endregion

		//#region 设置面板
		function NapcatPanel() {
			var remote = NapcatPanel.__remote;
			var t = NapcatPanel.__t;
			var [status, setStatus] = React.useState(null);
			var [busy, setBusy] = React.useState(false);
			var [error, setError] = React.useState("");
			var [webui, setWebui] = React.useState(null);

			// Every call is a Remote round-trip to the host: async, and the failure
			// mode is a rejected promise (no synchronous service object to read).
			var refresh = React.useCallback(function () {
				if (remote === undefined) { setError(t("noService")); return; }
				Promise.resolve(remote.getStatus()).then(function (next) {
					setStatus(next);
					setError("");
				}).catch(function (e) {
					setError(String(e && e.message ? e.message : e));
				});
			}, [remote, t]);

			React.useEffect(function () {
				refresh();
				var id = setInterval(refresh, 3000);
				return function () { clearInterval(id); };
			}, [refresh]);

			var run = function (action, confirmText) {
				if (remote === undefined) return;
				if (confirmText !== undefined && !window.confirm(confirmText)) return;
				setBusy(true);
				setError("");
				Promise.resolve(remote[action]()).then(function (res) {
					if (res && res.ok === false) setError(res.message || "");
					refresh();
				}).catch(function (e) {
					setError(String(e && e.message ? e.message : e));
				}).finally(function () { setBusy(false); });
			};

			if (status === null) {
				return h("div", { className: "nlc-wrap" }, h("div", { className: "nlc-card" }, t("desc")),
					error === "" ? null : h("div", { className: "nlc-err" }, error));
			}

			var awaiting = status.state === "awaiting-login";

			return h("div", { className: "nlc-wrap" },
				h("div", { className: "nlc-card" },
					h("h4", null, t("state")),
					h("div", { className: "nlc-row" },
						h("span", { className: "k" }, t("state")),
						h("span", { className: "v" },
							h("span", { className: "nlc-badge " + stateClass(status.state) },
								h("span", { className: "dot" }), stateLabel(t, status.state)))),
					h("div", { className: "nlc-row" }, h("span", { className: "k" }, t("botQQ")), h("span", { className: "v" }, status.botQQ || "—")),
					h("div", { className: "nlc-row" }, h("span", { className: "k" }, t("startedAt")), h("span", { className: "v" }, fmtTime(status.startedAt))),
					h("div", { className: "nlc-row" }, h("span", { className: "k" }, t("restarts")), h("span", { className: "v" }, String(status.restarts) + " / " + String(status.maxRestarts))),
					status.loginFailure === null ? null : h("div", { className: "nlc-row" }, h("span", { className: "k" }, t("loginFailure")), h("span", { className: "v" }, status.loginFailure)),
					status.lastExit === null ? null : h("div", { className: "nlc-row" },
						h("span", { className: "k" }, t("lastExit")),
						h("span", { className: "v" }, fmtTime(status.lastExit.at) + " · code " + String(status.lastExit.exitCode) + " · " + String(status.lastExit.reason))),
					awaiting ? h("div", { className: "nlc-hint" }, t("loginHint")) : null,
					h("div", { className: "nlc-actions" },
						h("button", { className: "nlc-btn primary", type: "button", onClick: function () { setWebui(status.webuiUrl); } }, t("openWebui")),
						h("button", { className: "nlc-btn", type: "button", disabled: busy || status.running, onClick: function () { run("start"); } }, t("start")),
						h("button", { className: "nlc-btn", type: "button", disabled: busy || !status.running, onClick: function () { run("stop", t("confirmStop")); } }, t("stop")),
						h("button", { className: "nlc-btn", type: "button", disabled: busy, onClick: function () { run("restart", t("confirmRestart")); } }, t("restart")),
						h("button", { className: "nlc-btn", type: "button", disabled: busy, onClick: refresh }, t("refresh")),
						busy ? h("span", { style: { opacity: .6, fontSize: 12 } }, t("working")) : null)),
				h("div", { className: "nlc-card" },
					h("h4", null, t("recentLog")),
					h("pre", { className: "nlc-log" }, status.recentLog === "" ? t("emptyLog") : status.recentLog)),
				error === "" ? null : h("div", { className: "nlc-err" }, error),
				webui === null ? null : h(WebuiModal, { url: webui, t: t, onClose: function () { setWebui(null); } }));
		}
		//#endregion

		//#region 客户端入口
		var inject = ["slots", "locale", "remote"];

		async function apply(ctx) {
			ctx.effect(function () {
				var tag = document.createElement("style");
				tag.dataset.plugin = PLUGIN_ID;
				tag.textContent = CSS;
				document.head.appendChild(tag);
				return function () { tag.remove(); };
			}, "napcat-lifecycle: style");

			ctx.effect(function () { return ctx.locale.register(NS, { zh: zh, en: en }); }, "napcat-lifecycle: dictionaries");
			var t = ctx.locale.bind(NS);

			// The panel runs in the browser: a host cordis service is NOT reachable
			// through ctx.get(). Mount the Typert Remote namespace and read it from
			// the remote service instead — that is the only supported channel.
			var disposeRemote = await ctx.remote.$mount(NAPCAT_SETTINGS_REMOTE);
			var remote = ctx.get("remote." + REMOTE_NS);
			if (remote === undefined) throw new Error("napcatLifecycle Remote 挂载后不可用");

			// Hand the remote service and translator to the panel component; the
			// slot registration API takes a component, not a factory.
			NapcatPanel.__remote = remote;
			NapcatPanel.__t = t;

			ctx.slots.inject("settings.section", function () {
				return ctx.slots.register({
					name: "settings.section",
					id: "napcat",
					order: 30,
					label: function () { return t("nav"); },
					locale: NS,
				}, NapcatPanel);
			});

			return function () { void disposeRemote(); };
		}
		//#endregion

		exports.inject = inject;
		exports.apply = apply;
		exports.NAPCAT_SETTINGS_REMOTE = NAPCAT_SETTINGS_REMOTE;
		exports.NAPCAT_SETTINGS_DESCRIPTORS = NAPCAT_SETTINGS_DESCRIPTORS;
		exports.NapcatPanel = NapcatPanel;
		exports.WebuiModal = WebuiModal;
		exports.zh = zh;
		exports.en = en;

		return module.exports;
	}
});