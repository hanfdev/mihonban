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
  prefetchNotice: ['The next track is preloaded only on an unmetered connection without Low Data Mode.', '次の曲の先読みは、低データモードでない従量制限のない接続でのみ行います。', '다음 곡은 저데이터 모드가 아닌 무제한 연결에서만 미리 받습니다.', 'Préchargement uniquement sur une connexion non limitée, sans mode de données réduites.', 'Precarga solo con conexión no medida y sin modo de datos reducidos.', '仅在非计费且未开启低数据模式的网络下预取下一首。', '僅在非計費且未開啟低數據模式的網路下預取下一首。'],
  cache: ['Local cache', 'ローカルキャッシュ', '로컬 캐시', 'Cache local', 'Caché local', '本地缓存', '本機快取'],
  cacheEnable: ['Cache covers and audio on this iPhone', 'カバーと音声をこの iPhone に保存', '커버와 오디오를 이 iPhone에 저장', 'Conserver pochettes et audio sur cet iPhone', 'Guardar carátulas y audio en este iPhone', '在本机缓存封面和音频', '在本機快取封面與音訊'],
  cacheHint: ['Cached tracks start instantly and keep playing offline. The oldest files are removed once the limit is reached.', 'キャッシュした曲はすぐに再生でき、オフラインでも聴けます。上限に達すると古いファイルから削除されます。', '캐시된 곡은 즉시 재생되고 오프라인에서도 재생됩니다. 한도에 도달하면 오래된 파일부터 삭제합니다.', 'Les titres en cache démarrent instantanément et restent lisibles hors connexion. Les fichiers les plus anciens sont supprimés à la limite.', 'Las pistas en caché empiezan al instante y siguen sonando sin conexión. Al alcanzar el límite se eliminan los archivos más antiguos.', '缓存的曲目可立即起播，离线也能继续听；达到上限后从最旧的文件开始清理。', '快取的曲目可立即起播，離線也能繼續聽；達到上限後從最舊的檔案開始清理。'],
  cacheOffNotice: ['Caching is off. Audio streams while you listen and is discarded afterwards.', 'キャッシュは無効です。音声は再生中にストリーミングされ、終了後に破棄されます。', '캐시가 꺼져 있습니다. 오디오는 재생 중 스트리밍되고 끝나면 삭제됩니다.', 'Cache désactivé : l’audio est diffusé pendant l’écoute puis supprimé.', 'Caché desactivada: el audio se transmite mientras escuchas y se descarta después.', '缓存已关闭：音频边听边传，听完即丢弃。', '快取已關閉：音訊邊聽邊傳，聽完即丟棄。'],
  cacheLimit: ['Size limit', '容量上限', '용량 한도', 'Taille maximale', 'Tamaño máximo', '大小上限', '容量上限'],
  cacheUsed: ['Used', '使用中', '사용 중', 'Utilisé', 'Utilizado', '已使用', '已使用'],
  clearCache: ['Clear cache', 'キャッシュを消去', '캐시 비우기', 'Vider le cache', 'Vaciar caché', '清除缓存', '清除快取'],
  cacheCleared: ['Cache cleared', 'キャッシュを消去しました', '캐시를 비웠습니다', 'Cache vidé', 'Caché vaciada', '缓存已清除', '快取已清除'],
  preloadNext: ['Preload the next queued track', '次のキュー曲を先読みする', '대기열의 다음 곡 미리 받기', 'Précharger le prochain titre', 'Precargar la siguiente canción', '提前缓存队列中的下一首', '提前快取佇列中的下一首'],
  disconnectConfirm: ['Stop playback and sign out?', '再生を停止してログアウトしますか？', '재생을 중지하고 로그아웃할까요?', 'Arrêter la lecture et se déconnecter ?', '¿Detener la reproducción y cerrar sesión?', '停止播放并退出登录？', '停止播放並登出？'],
  permissionDenied: ['Your account cannot perform this action.', 'この操作は許可されていません。', '이 작업을 수행할 권한이 없습니다.', 'Votre compte ne permet pas cette action.', 'Tu cuenta no permite esta acción.', '当前账号没有此操作的权限。', '目前帳號沒有此操作的權限。'],
  itemMissing: ['This item is no longer available.', 'この項目は利用できなくなりました。', '이 항목은 더 이상 사용할 수 없습니다.', 'Cet élément n’est plus disponible.', 'Este elemento ya no está disponible.', '此项目已不可用。', '此項目已無法使用。'],
  conflict: ['The library changed. Refresh and try again.', 'ライブラリが変更されました。更新して再試行してください。', '보관함이 변경되었습니다. 새로고침 후 다시 시도하세요.', 'La bibliothèque a changé. Actualisez puis réessayez.', 'La biblioteca ha cambiado. Actualiza e inténtalo de nuevo.', '曲库已发生变化，请刷新后重试。', '曲庫已發生變更，請重新整理後再試。'],
  downloads: ['Downloads', 'ダウンロード', '다운로드', 'Téléchargements', 'Descargas', '下载', '下載'],
  download: ['Download', 'ダウンロード', '다운로드', 'Télécharger', 'Descargar', '下载', '下載'],
  playNext: ['Play next', '次に再生', '다음에 재생', 'Lire ensuite', 'Reproducir a continuación', '下一首播放', '下一首播放'],
  addToQueue: ['Add to queue', 'キューに追加', '대기열에 추가', 'Ajouter à la file', 'Añadir a la cola', '加入播放队列', '加入播放佇列'],
  allResults: ['All', 'すべて', '전체', 'Tout', 'Todo', '全部', '全部'],
  filters: ['Filters', '絞り込み', '필터', 'Filtres', 'Filtros', '筛选', '篩選'],
  sort: ['Sort', '並べ替え', '정렬', 'Trier', 'Ordenar', '排序', '排序'],
  licenses: ['Open-source licenses', 'オープンソースライセンス', '오픈 소스 라이선스', 'Licences libres', 'Licencias de código abierto', '开源许可', '開源授權'],
}
const { en } = await import('../../cloud/web/src/locales/en.js')
const { adminEn } = await import('../../cloud/web/src/i18n-admin-en.js')
const catalogs = {}
function flatten(base, translated, prefix = '', result = {}) {
  for (const [name, fallback] of Object.entries(base)) {
    const key = prefix ? `${prefix}.${name}` : name
    const value = translated?.[name] ?? fallback
    if (typeof fallback === 'function') {
      result[key] = value('{0}', '{1}', '{2}', '{3}')
    } else if (typeof fallback === 'object' && fallback !== null) {
      flatten(fallback, value, key, result)
    } else if (typeof value === 'string') result[key] = value
  }
  return result
}
for (const [index, language] of languages.entries()) {
  const web = language === 'en' ? en : (await import(`../../cloud/web/src/locales/${language}.js`)).default
  const admin = language === 'en' ? adminEn : (await import(`../../cloud/web/src/locales/admin-${language}.js`)).admin
  const result = flatten(en, web)
  flatten(adminEn, admin, 'admin', result)
  for (const [key, values] of Object.entries(extra)) {
    if (values.length !== languages.length || values.some(value => !value)) throw new Error(`Incomplete translation: ${key}`)
    result['mobile.' + key] = values[index]
  }
  catalogs[language] = result
}
fs.mkdirSync(path.join(root, 'Resources'), { recursive: true })
fs.writeFileSync(path.join(root, 'Resources/Localizations.json'), JSON.stringify(catalogs, null, 2) + '\n')
console.log(`Exported ${languages.length} iOS catalogs`)
