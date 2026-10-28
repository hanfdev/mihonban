import { en } from '../../cloud/web/src/locales/en.js'

const ids = ['en', 'ja', 'ko', 'fr', 'es', 'zh-Hans', 'zh-Hant']
const sections = ['nav', 'search', 'login', 'common', 'library', 'tracks', 'favs',
  'player', 'artistPage', 'artists', 'albumPage', 'rym', 'md', 'empty']
const functions = ['count.albums', 'count.tracks', 'time.minutes', 'time.hoursMinutes',
  'artists.albums', 'artists.featuredTracks', 'rym.votes', 'common.disc']
const native = {
  settings: ['Settings', '設定', '설정', 'Réglages', 'Ajustes', '设置', '設定'],
  connection: ['Service connection', 'サービス接続', '서버 연결', 'Connexion au service', 'Conexión al servicio', '服务连接', '服務連線'],
  profile: ['Profile', 'プロファイル', '프로필', 'Profil', 'Perfil', '配置', '設定檔'],
  addProfile: ['Add profile', '追加', '프로필 추가', 'Ajouter un profil', 'Añadir perfil', '添加配置', '新增設定檔'],
  profileName: ['Profile name', 'プロファイル名', '프로필 이름', 'Nom du profil', 'Nombre del perfil', '配置名称', '設定檔名稱'],
  address: ['Service address', 'サービスアドレス', '서버 주소', 'Adresse du service', 'Dirección del servicio', '服务地址', '服務位址'],
  manifest: ['Update manifest', '更新マニフェスト', '업데이트 매니페스트', 'Manifeste de mise à jour', 'Manifiesto de actualización', '客户端更新清单', '用戶端更新清單'],
  manifestHint: ['Optional client release JSON URL', '任意のクライアント更新 JSON URL', '선택 사항: 클라이언트 릴리스 JSON URL', 'URL JSON de version du client (facultative)', 'URL JSON de versión del cliente (opcional)', '可选：客户端版本 JSON 地址', '選填：用戶端版本 JSON 位址'],
  remember: ['Save password in Windows Credential Manager', 'Windows 資格情報マネージャーに保存', 'Windows 자격 증명 관리자에 비밀번호 저장', 'Enregistrer dans le Gestionnaire d’identifiants Windows', 'Guardar contraseña en el Administrador de credenciales de Windows', '将密码保存到 Windows 凭据管理器', '將密碼儲存至 Windows 認證管理員'],
  saveProfile: ['Save profile', '保存', '프로필 저장', 'Enregistrer le profil', 'Guardar perfil', '保存配置', '儲存設定檔'],
  connect: ['Connect', '接続', '연결', 'Connecter', 'Conectar', '连接', '連線'],
  checkUpdates: ['Check for client updates', 'クライアントの更新を確認', '클라이언트 업데이트 확인', 'Rechercher des mises à jour', 'Buscar actualizaciones', '检查客户端更新', '檢查用戶端更新'],
  downloadUpdate: ['Download verified update', '検証済みの更新をダウンロード', '검증된 업데이트 다운로드', 'Télécharger la mise à jour vérifiée', 'Descargar actualización verificada', '下载并校验更新', '下載並驗證更新'],
  windowBehavior: ['Window behavior', 'ウィンドウの動作', '창 동작', 'Comportement de la fenêtre', 'Comportamiento de la ventana', '窗口行为', '視窗行為'],
  minimizeToTray: ['Minimize to the system tray', '最小化時にシステムトレイへ移動', '최소화할 때 시스템 트레이로 숨기기', 'Réduire dans la zone de notification', 'Minimizar en la bandeja del sistema', '最小化时隐藏到系统托盘', '最小化時隱藏至系統匣'],
  closeToTray: ['Keep running in the tray when closing the window', 'ウィンドウを閉じてもトレイで実行を続ける', '창을 닫아도 트레이에서 계속 실행', 'Rester dans la zone de notification à la fermeture', 'Seguir en la bandeja al cerrar la ventana', '关闭窗口时保留在系统托盘', '關閉視窗時保留在系統匣'],
  trayHint: ['Double-click the tray icon to restore the window; right-click to play/pause or exit. Changes save automatically.', 'トレイアイコンをダブルクリックして復元。右クリックで再生・一時停止や終了ができます。変更は自動保存されます。', '트레이 아이콘을 두 번 클릭하면 창이 복원됩니다. 오른쪽 클릭으로 재생/일시 정지하거나 종료할 수 있습니다. 변경 사항은 자동 저장됩니다.', 'Double-cliquez sur l’icône pour rétablir la fenêtre ; faites un clic droit pour lire, mettre en pause ou quitter. Les modifications sont enregistrées automatiquement.', 'Haz doble clic en el icono para restaurar la ventana; haz clic derecho para reproducir, pausar o salir. Los cambios se guardan automáticamente.', '双击托盘图标恢复窗口；右键可播放/暂停或退出。更改会自动保存。', '按兩下系統匣圖示還原視窗；按右鍵可播放／暫停或結束。變更會自動儲存。'],
  trayShow: ['Show main window', 'メインウィンドウを表示', '메인 창 표시', 'Afficher la fenêtre principale', 'Mostrar ventana principal', '显示主窗口', '顯示主視窗'],
  trayExit: ['Exit Mihonban', 'Mihonban を終了', 'Mihonban 종료', 'Quitter Mihonban', 'Salir de Mihonban', '退出 Mihonban', '結束 Mihonban'],
  trayUnavailable: ['System tray unavailable', 'システムトレイを利用できません', '시스템 트레이를 사용할 수 없습니다', 'Zone de notification indisponible', 'Bandeja del sistema no disponible', '系统托盘不可用', '系統匣無法使用'],
  cache: ['Local cache', 'ローカルキャッシュ', '로컬 캐시', 'Cache local', 'Caché local', '本地缓存', '本機快取'],
  cacheEnable: ['Cache artwork and audio locally', '画像と音声をローカルに保存', '이미지와 오디오를 로컬에 캐시', 'Conserver les images et l’audio localement', 'Guardar imágenes y audio localmente', '在本地缓存封面和音频', '在本機快取封面與音訊'],
  cacheHint: ['Each service has its own cache. Least recently used files are removed when the limit is reached.', 'サービスごとに保存します。上限を超えると古いキャッシュから削除されます。', '서버별로 캐시를 저장합니다. 한도에 도달하면 오래 사용하지 않은 파일부터 정리합니다.', 'Chaque service a son cache. Les fichiers les moins utilisés sont supprimés à la limite.', 'Cada servicio tiene su caché. Al alcanzar el límite se eliminan los archivos menos usados.', '按服务独立保存。达到上限时，自动清理最久未使用的缓存。', '依服務分開儲存。達到上限時，自動清理最久未使用的快取。'],
  cacheDirectory: ['Cache folder', '保存先', '캐시 폴더', 'Dossier du cache', 'Carpeta de caché', '缓存目录', '快取目錄'],
  preloadNextTrack: ['Preload the next queued track', '次のキュー曲を先読みする', '대기열의 다음 곡 미리 받기', 'Précharger le prochain titre', 'Precargar la siguiente canción', '提前缓存队列中的下一首', '提前快取佇列中的下一首'],
  preloadNextTrackHint: ['Downloads one upcoming track into the local cache while the current track plays.', '再生中に、次の 1 曲だけをローカルキャッシュへダウンロードします。', '현재 곡 재생 중 다음 한 곡만 로컬 캐시에 다운로드합니다.', 'Télécharge un seul titre à venir dans le cache local pendant la lecture.', 'Descarga una sola canción de la cola al caché local mientras suena la actual.', '当前歌曲播放时，只将队列中的下一首下载到本地缓存。', '目前歌曲播放時，只將佇列中的下一首下載到本機快取。'],
  cacheDefaultHint: ['Windows local app data by default', '既定は Windows ローカルアプリデータ', '기본값: Windows 로컬 앱 데이터', 'Données locales Windows par défaut', 'Datos locales de Windows por defecto', '默认为 Windows 本地应用数据目录', '預設為 Windows 本機應用程式資料目錄'],
  cacheLimit: ['Size limit', '容量上限', '용량 한도', 'Taille maximale', 'Tamaño máximo', '大小上限', '容量上限'],
  used: ['Used', '使用中', '사용 중', 'Utilisé', 'Utilizado', '已使用', '已使用'],
  defaultDirectory: ['Use default folder', '既定の保存先', '기본 폴더 사용', 'Dossier par défaut', 'Carpeta predeterminada', '使用默认目录', '使用預設目錄'],
  saveCache: ['Save cache settings', 'キャッシュ設定を保存', '캐시 설정 저장', 'Enregistrer le cache', 'Guardar ajustes de caché', '保存缓存设置', '儲存快取設定'],
  clearCache: ['Clear cache', 'キャッシュを消去', '캐시 비우기', 'Vider le cache', 'Vaciar caché', '清除缓存', '清除快取'],
  openDirectory: ['Open folder', 'フォルダーを開く', '폴더 열기', 'Ouvrir le dossier', 'Abrir carpeta', '打开目录', '開啟目錄'],
  compatibility: ['The native client updates independently of Mihonban. Compatible service API updates work without reinstalling the client.', 'ネイティブクライアントは Mihonban と独立して更新されます。互換 API の更新後もそのまま利用できます。', '네이티브 클라이언트는 Mihonban과 별도로 업데이트됩니다. 호환 API 업데이트 후에도 계속 사용할 수 있습니다.', 'Le client natif se met à jour indépendamment de Mihonban. Les API compatibles fonctionnent sans réinstallation.', 'El cliente nativo se actualiza de forma independiente. Las API compatibles funcionan sin reinstalarlo.', '原生客户端独立更新。Mihonban 服务的兼容 API 更新无需重新安装客户端。', '原生用戶端獨立更新。Mihonban 服務的相容 API 更新無需重新安裝用戶端。'],
  connectHint: ['Connect to a Mihonban service to view your collection', 'Mihonban に接続してコレクションを表示', 'Mihonban 서버에 연결하여 컬렉션 보기', 'Connectez un service Mihonban pour voir votre collection', 'Conecta un servicio Mihonban para ver tu colección', '连接 Mihonban 服务以查看收藏', '連線至 Mihonban 服務以檢視收藏'],
  disconnected: ['Disconnected', '未接続', '연결되지 않음', 'Déconnecté', 'Desconectado', '未连接', '未連線'],
  connecting: ['Connecting…', '接続中…', '연결 중…', 'Connexion…', 'Conectando…', '正在连接…', '正在連線…'],
  ready: ['Ready', '準備完了', '준비됨', 'Prêt', 'Listo', '准备就绪', '準備就緒'],
  connected: ['Connected', '接続済み', '연결됨', 'Connecté', 'Conectado', '已连接', '已連線'],
  saved: ['Saved', '保存しました', '저장됨', 'Enregistré', 'Guardado', '已保存', '已儲存'],
  cacheCleared: ['Cache cleared', '消去しました', '캐시를 비웠습니다', 'Cache vidé', 'Caché vaciada', '缓存已清除', '快取已清除'],
  preparing: ['Preparing audio…', '音声を準備中…', '오디오 준비 중…', 'Préparation audio…', 'Preparando audio…', '正在准备音频…', '正在準備音訊…'],
  playing: ['Playing', '再生中', '재생 중', 'Lecture', 'Reproduciendo', '正在播放', '正在播放'],
  noTracks: ['No tracks yet', '曲がありません', '아직 곡이 없습니다', 'Aucune piste', 'Sin pistas', '暂无歌曲', '尚無歌曲'],
}

// Player-page keys that exist only in the native client. They are merged
// into the player section so regenerating catalogs from the Web sources
// keeps them intact.
const playerNative = {
  fullscreen: ['Fullscreen (F11)', '全画面 (F11)', '전체 화면 (F11)', 'Plein écran (F11)', 'Pantalla completa (F11)', '全屏 (F11)', '全螢幕 (F11)'],
  exitFullscreen: ['Exit fullscreen (Esc)', '全画面を終了 (Esc)', '전체 화면 종료 (Esc)', 'Quitter le plein écran (Esc)', 'Salir de pantalla completa (Esc)', '退出全屏 (Esc)', '結束全螢幕 (Esc)'],
}

const catalogs = {}
for (const [index, id] of ids.entries()) {
  const dictionary = id === 'en' ? en : (await import(`../../cloud/web/src/locales/${id}.js`)).default
  const catalog = {}
  for (const section of sections) {
    for (const [name, value] of Object.entries(dictionary[section] || en[section] || {})) {
      if (typeof value === 'string') catalog[`${section}.${name}`] = value
    }
  }
  for (const path of functions) {
    const [section, name] = path.split('.')
    catalog[path] = (dictionary[section]?.[name] || en[section][name])('{0}', '{1}')
  }
  for (const [key, values] of Object.entries(native)) catalog[`desktop.${key}`] = values[index]
  for (const [key, values] of Object.entries(playerNative)) catalog[`player.${key}`] = values[index]
  catalogs[id] = catalog
}
process.stdout.write(JSON.stringify(catalogs))
