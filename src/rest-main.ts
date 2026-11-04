// 休息窗口入口：主屏完整界面；副屏（#mirror）简洁镜像
import { mountRestApp } from './features/rest/rest-view';
import { mountRestMirror } from './features/rest/mirror-view';

const root = document.querySelector('#app') as HTMLElement;
if (location.hash === '#mirror') {
  mountRestMirror(root);
} else {
  mountRestApp(root);
}
