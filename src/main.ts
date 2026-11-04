// 入口：主窗口 与 桌面小时钟（#widget）共用 bundle 与渲染进程
import { mountMainApp } from './features/timer/main-view';
import { mountWidget } from './features/widget/widget-view';

const root = document.querySelector('#app') as HTMLElement;
if (location.hash === '#widget') {
  mountWidget(root);
} else {
  mountMainApp(root);
}
