# dsh-skin-tuner

给 DeepSeek Harness（dsh）Web 界面用的**独立外观微调面板**：背景遮挡、背景模糊、输入卡磨砂、气泡不透明度、气泡模糊，全部收在 `设置 → 外观微调` 一页里。

它**不依赖任何皮肤**，也**不安装皮肤**。所有参数落在 `<harness-home>/dsh-skin-tuner.json`，重启后继续生效；关掉总开关就立刻回到未安装状态（写入的变量和元素全部移除）。

---

## 为什么单独做这个

皮肤中心（`@linxin666/dsh-client-ui-skin-center`）里有同样的滑杆，但它被绑在"皮肤加载器"这个身份上：停用它就同时失去皮肤与滑杆。本插件把那几个滑杆抽出来做成独立插件，于是——

- 只想调透明度/模糊、不想装皮肤：可以；
- 关掉皮肤中心之后仍然能调：可以；
- 两套皮肤/主题互相打架时，作为唯一的写入方：可以。

## 安装

```sh
# 从 GitHub（推荐）
dsh plugin --profile <profile> add 'github:1207627875/dsh-skin-tuner'

# 本地克隆后（开发迭代：改完源码跑 npm run build，重启 DSH 即生效）
git clone https://github.com/1207627875/dsh-skin-tuner.git
cd dsh-skin-tuner && npm install && npm run build
dsh plugin --profile <profile> add .
```

`dsh plugin` 会把依赖写进 profile 的 `package.json`，并把本包加进 `dsh.profile.bundles`（本包带 `dsh.bundle.patch`）。

**桌面端（Electron 独占的 `desktop` profile）**：外部 CLI 无法启动该 profile，走侧边栏 **插件** 页安装；本地开发时也可以手改 profile 的 `package.json`：

```json
{
  "dependencies": { "dsh-skin-tuner": "link:D:/path/to/dsh-skin-tuner" },
  "dsh": { "profile": { "bundles": ["…", "dsh-skin-tuner"] } }
}
```

然后在 `profiles/<name>` 目录里跑一次 `pnpm install`。依赖名必须在 `dsh.profile.bundles` 里出现，否则不会被加载。

**重启后**浏览器会加载新的客户端插件，设置页出现「外观微调」。

## 面板

| 控件 | 范围 | 默认 | 作用 |
|---|---|---|---|
| 启用微调 | 开/关 | 开 | 总开关。关闭即移除全部写入 |
| 背景遮挡 | 0–100% | 0 | 给面板背后的背景图加纱；0 不遮，100 几乎全遮 |
| 空对话背景模糊 | 0–20px | 0 | 对话为空时的背景高斯模糊 |
| 有对话背景模糊 | 0–20px | 0 | 对话有内容时的背景高斯模糊 |
| 输入卡磨砂 | 0–20px | 10 | 只模糊输入卡背后的区域 |
| 气泡不透明度 | 0–100% | 100 | 消息气泡不透明度，越高越清楚 |
| 气泡模糊 | 0–20px | 0 | 模糊半透明气泡背后的区域 |

拖动即时生效；写入是合并的（120 ms 内的连续拖动只发一次 POST）。

## 写入的契约

面板不改任何皮肤文件，只写皮肤生态已经在读的自定义属性与标记：

| 名称 | 值 | 谁读 |
|---|---|---|
| `--dsw-skin-scrim` | `0`–`1` | 画背景图的皮肤（`rgba(..., calc(1 - var(--dsw-skin-scrim) * .5))` 这类写法） |
| `--dsh-skin-bubble-alpha` | `0`–`1` | 暴露气泡 alpha 的皮肤 |
| `--dsh-skin-bubble-blur` | `px` | 本插件自己的气泡模糊规则 |
| `--dsh-input-card-blur` | `px` | 输入卡磨砂 |
| `body[data-skin-tuner]` | 存在即启用 | 本插件的样式门控 |
| `body[data-skin-tuner-content]` | 有消息时存在 | 选择"空对话/有内容"两档背景模糊 |
| `[data-skin-tuner-backdrop]` | 注入元素 | 背景遮挡与背景模糊的载体（`z-index: 0`） |
| `[data-skin-tuner-composer-frost]` | 注入元素 | 跟随输入卡的外置磨砂层 |

因此一个已经支持这些属性的皮肤**不需要改一行代码**就能被本面板调；没有皮肤时，遮挡、气泡不透明度与输入卡磨砂依然有效。

## 和其他插件同时启用

**同一批属性只有一个写入方会赢（后写者生效）。** 本插件与皮肤中心写的是同一组属性，所以：

- 同时启用时，面板顶部会显示一行提示，告诉你检测到皮肤中心正在运行；
- 建议二选一：要用本插件调，就停用皮肤中心；要用皮肤中心的，就关掉本插件的总开关。

本插件不读、不写皮肤中心或任何皮肤的文件，卸载/停用后不留残留。

## 开发

```sh
npm install        # 只装 esbuild
npm test           # 15 个用例：schema、store、控制器、DOM 写入、打包产物冒烟
npm run build      # src/client/* → client.js（DSH 客户端模块格式）
```

`client.js` 是**构建产物**，改完客户端源码要重新构建并一起提交。

打包格式：DSH 客户端把每个插件包成 `window.__ModuleLoader__.load({ id, factory })`，`scripts/build-client.mjs` 用 esbuild 的 banner/footer 生成这层壳；`react` 与客户端运行时保持 external，避免打进第二份 React。

## 已知边界

- **零值不产生模糊层**：任何模糊为 0 时，对应的 `backdrop-filter` 与元素都**不存在**（而不是 `blur(0px)`——那仍会创建 backdrop root 与合成层）。默认外观下唯一的模糊面是输入卡磨砂。
- **每个模糊面都有自己的 backdrop root**：模糊元素都带 `isolation: isolate`。没有它时 `backdrop-filter` 会模糊其下方**所有**内容——包括本插件的另一个面，那会把输入卡磨砂抹到整个会话上。
- **两个注入元素挂在 `<html>` 上，不在 `body` 里**：app 的 `body` 子树里只要有带 filter/transform 的祖先，`position: fixed` 子元素就会变成"定位后代"，落点全错。
- 气泡模糊依赖气泡自身是半透明的；完全不透明的气泡看不出效果。
- 气泡模糊会给每条消息行加 `backdrop-filter`，条数很多的会话里可能增加 GPU 开销；不需要时保持 0。
- 背景模糊跟随"会话是否有消息"切换，检测是 500 ms 轮询，切换瞬间可能有极短延迟。
- 遮罩/磨砂只对**画背景图**的皮肤可见；官方默认外观没有背景图，看不出差别。

## 实现注记（给改代码的人）

- **词典必须是扁平的、带点的键**。客户端 locale 的 `lookup` 是 `dict[key]` 字面属性查找，**不会**展开嵌套对象；写成 `{ fields: { x: { label } } }` 会静默回退成"把键名当文案显示"。`tests/bundle-smoke.test.mjs` 守住这条契约。
- **范围钳制在宿主侧**：面板乐观上屏 → POST 到 `/dsh-skin-tuner/settings` → 宿主按 schema 夹紧后原子落盘。
- **写请求必须同源**：同一种回环监听的两种写法（`127.0.0.1` 与 `localhost`，端口一致）等价接受；缺少 `Origin` 头或端口不同一律 403，且 403 文案会带上被拒的 `Origin` 与 `Host`，便于排查。

## 许可

MIT
