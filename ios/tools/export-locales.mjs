import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const languages = ['en', 'ja', 'ko', 'fr', 'es', 'zh-Hans', 'zh-Hant']
const extra = {
  address: ['Service address', 'サーバーアドレス', '서버 주소', 'Adresse du service', 'Dirección del servicio', '服务地址', '服務位址'],
  connect: ['Connect', '接続', '연결', 'Connecter', 'Conectar', '连接', '連線'],
  connecting: ['Connecting…', '接続中…', '연결 중…', 'Connexion…', 'Conectando…', '正在连接…', '正在連線…'],
  connection: ['Service connection', 'サーバー接続', '서버 연결', 'Connexion au service', 'Conexión al servicio', '服务连接', '服務連線'],
  connectHint: ['Your collection, wherever you listen.', 'いつもの音楽を、どこでも。', '어디서든 나의 음악을.', 'Votre collection, partout avec vous.', 'Tu colección, donde quieras escuchar.', '随时随地，听自己的收藏。', '隨時隨地，聽自己的收藏。'],
  optionalPassword: ['Optional when guest access is enabled', 'ゲストアクセス有効時は省略可', '게스트 접속 시 생략 가능', 'Facultatif si l’accès invité est activé', 'Opcional si se permite acceso de invitados', '已开启访客访问时可留空', '已開啟訪客存取時可留空'],
  remember: ['Save password in Keychain', 'パスワードをキーチェーンに保存', '키체인에 비밀번호 저장', 'Enregistrer le mot de passe dans le trousseau', 'Guardar la contraseña en el llavero', '将口令保存在钥匙串', '將口令儲存於鑰匙圈'],
  settings: ['Settings', '設定', '설정', 'Réglages', 'Ajustes', '设置', '設定'],
  preparing: ['Buffering…', '読み込み中…', '버퍼링 중…', 'Mise en mémoire…', 'Cargando audio…', '正在缓冲…', '正在緩衝…'],
  nowPlaying: ['Now playing', '再生中', '지금 재생 중', 'À l’écoute', 'Reproduciendo', '正在播放', '正在播放'],
  queue: ['Queue', '再生キュー', '재생 대기열', 'File d’attente', 'Cola', '播放队列', '播放佇列'],
  upNext: ['Up next', '次に再生', '다음 곡', 'À suivre', 'A continuación', '接下来播放', '接下來播放'],
  collapse: ['Close player', 'プレーヤーを閉じる', '플레이어 닫기', 'Fermer le lecteur', 'Cerrar reproductor', '收起播放器', '收起播放器'],
  audioOutput: ['Audio output', '出力先', '오디오 출력', 'Sortie audio', 'Salida de audio', '音频输出', '音訊輸出'],
  searchAlbums: ['Search albums and artists', 'アルバム・アーティストを検索', '앨범과 아티스트 검색', 'Rechercher des albums et artistes', 'Buscar álbumes y artistas', '搜索专辑与艺人', '搜尋專輯與藝人'],
  invalidAddress: ['Enter a full http:// or https:// address.', 'http:// または https:// で始まるアドレスを入力してください。', 'http:// 또는 https://로 시작하는 주소를 입력하세요.', 'Saisissez une adresse complète en http:// ou https://.', 'Introduce una dirección completa con http:// o https://.', '请输入以 http:// 或 https:// 开头的完整地址。', '請輸入以 http:// 或 https:// 開頭的完整位址。'],
  connectionFailed: ['Could not reach the service. Check the address and connection, then try again.', 'サーバーに接続できません。アドレスと通信状況を確認してください。', '서버에 연결할 수 없습니다. 주소와 연결 상태를 확인하세요.', 'Service inaccessible. Vérifiez l’adresse et la connexion, puis réessayez.', 'No se pudo conectar. Comprueba la dirección y la conexión e inténtalo de nuevo.', '无法连接服务，请检查地址和网络后重试。', '無法連線至服務，請檢查位址與網路後重試。'],
  wrongPassword: ['Incorrect password.', 'パスワードが違います。', '비밀번호가 올바르지 않습니다.', 'Mot de passe incorrect.', 'Contraseña incorrecta.', '口令不正确。', '口令不正確。'],
  sessionExpired: ['Sign in with your service password.', 'サーバーのパスワードでログインしてください。', '서버 비밀번호로 로그인하세요.', 'Connectez-vous avec le mot de passe du service.', 'Inicia sesión con la contraseña del servicio.', '请使用服务口令登录。', '請使用服務口令登入。'],
  rateLimited: ['Too many attempts. Try again in 15 minutes.', '試行回数が多すぎます。15 分後にお試しください。', '시도 횟수가 너무 많습니다. 15분 후 다시 시도하세요.', 'Trop de tentatives. Réessayez dans 15 minutes.', 'Demasiados intentos. Vuelve a intentarlo en 15 minutos.', '尝试过于频繁，请在 15 分钟后重试。', '嘗試過於頻繁，請在 15 分鐘後重試。'],
  playbackFailed: ['Could not play this track. Check your connection or try the next track.', 'この曲を再生できません。接続を確認するか、次の曲をお試しください。', '재생할 수 없습니다. 연결을 확인하거나 다음 곡을 재생하세요.', 'Lecture impossible. Vérifiez la connexion ou essayez la piste suivante.', 'No se puede reproducir. Comprueba la conexión o prueba la siguiente pista.', '无法播放这首曲目，请检查网络或尝试下一首。', '無法播放這首曲目，請檢查網路或嘗試下一首。'],
  audioReset: ['Audio was interrupted by the system. Select a track to resume.', 'システムにより音声が停止しました。曲を選んで再開してください。', '시스템이 오디오를 중단했습니다. 곡을 선택해 다시 재생하세요.', 'Le système a interrompu l’audio. Sélectionnez une piste pour reprendre.', 'El sistema interrumpió el audio. Selecciona una pista para continuar.', '系统重置了音频服务，请重新选择曲目播放。', '系統重設了音訊服務，請重新選擇曲目播放。'],
  keychainFailed: ['Connected, but the password could not be saved. Sign in again after restarting.', '接続しましたが、パスワードを保存できませんでした。再起動後に再ログインしてください。', '연결했지만 비밀번호를 저장하지 못했습니다. 재시작 후 다시 로그인하세요.', 'Connexion établie, mais le mot de passe n’a pas été enregistré. Reconnectez-vous après redémarrage.', 'Conectado, pero no se pudo guardar la contraseña. Inicia sesión tras reiniciar.', '连接成功，但口令未能保存，重启后需要重新登录。', '連線成功，但口令未能儲存，重新啟動後需要再次登入。'],
  insecureHTTP: ['HTTP does not encrypt your password or audio. Use HTTPS outside a trusted network.', 'HTTP はパスワードや音声を暗号化しません。信頼できないネットワークでは HTTPS を使ってください。', 'HTTP는 비밀번호와 오디오를 암호화하지 않습니다. 외부 네트워크에서는 HTTPS를 사용하세요.', 'HTTP ne chiffre ni le mot de passe ni l’audio. Utilisez HTTPS hors d’un réseau de confiance.', 'HTTP no cifra tu contraseña ni el audio. Usa HTTPS fuera de una red de confianza.', 'HTTP 不会加密口令或音频；在可信网络之外请使用 HTTPS。', 'HTTP 不會加密口令或音訊；在可信網路之外請使用 HTTPS。'],
  m0Notice: ['Early preview: albums, playback and lock-screen controls. More library views and offline downloads will follow.', '初期プレビュー：アルバム、再生、ロック画面操作。その他の画面やオフライン保存は今後追加します。', '초기 미리보기: 앨범, 재생, 잠금 화면 제어. 다른 보관함 화면과 오프라인 다운로드는 추후 제공됩니다.', 'Aperçu initial : albums, lecture et commandes sur écran verrouillé. Autres vues et téléchargements hors ligne à venir.', 'Vista previa: álbumes, reproducción y controles en pantalla bloqueada. Más vistas y descargas sin conexión llegarán después.', '初期预览：专辑、播放与锁屏控制。其他曲库视图和离线下载将在后续加入。', '初期預覽：專輯、播放與鎖定畫面控制。其他曲庫檢視與離線下載將於後續加入。'],
  prefetchNotice: ['The next track is preloaded only on an unmetered connection without Low Data Mode. Audio cache is limited to 1 GB between sessions.', '次の曲の先読みは、低データモードでない従量制限のない接続でのみ行います。音声キャッシュは起動時に 1 GB 以内に整理します。', '다음 곡은 저데이터 모드가 아닌 무제한 연결에서만 미리 받습니다. 오디오 캐시는 시작 시 1GB 이내로 정리됩니다.', 'Préchargement uniquement sur une connexion non limitée, sans mode de données réduites. Cache audio limité à 1 Go entre les sessions.', 'Precarga solo con conexión no medida y sin modo de datos reducidos. Caché de audio limitada a 1 GB entre sesiones.', '仅在非计费且未开启低数据模式的网络下预取下一首。音频缓存会在连接时清理至 1 GB 以内。', '僅在非計費且未開啟低數據模式的網路下預取下一首。音訊快取會在連線時清理至 1 GB 以內。'],
  disconnectConfirm: ['Stop playback and sign out?', '再生を停止してログアウトしますか？', '재생을 중지하고 로그아웃할까요?', 'Arrêter la lecture et se déconnecter ?', '¿Detener la reproducción y cerrar sesión?', '停止播放并退出登录？', '停止播放並登出？'],
  licenses: ['Open-source licenses', 'オープンソースライセンス', '오픈 소스 라이선스', 'Licences libres', 'Licencias de código abierto', '开源许可', '開源授權'],
}
const catalogs = {}
for (const [index, language] of languages.entries()) {
  const native = JSON.parse(fs.readFileSync(path.join(root, '../desktop/assets/locales', language + '.json'), 'utf8'))
  const result = Object.fromEntries(Object.entries(native).filter(([key]) => !key.startsWith('desktop.') && !key.startsWith('albumPage.')))
  for (const [key, values] of Object.entries(extra)) result['mobile.' + key] = values[index]
  catalogs[language] = result
}
fs.mkdirSync(path.join(root, 'Resources'), { recursive: true })
fs.writeFileSync(path.join(root, 'Resources/Localizations.json'), JSON.stringify(catalogs, null, 2) + '\n')
console.log(`Exported ${languages.length} iOS catalogs`)
