# Dawnline Workshop Online

Онлайн-мастерская планов модов DayZ для Cloudflare Pages.

## Возможности

- Публичные проекты видны всем посетителям.
- Приватные проекты не попадают в публичный список и открываются по паролю.
- Ссылка на приватный проект копируется из карточки проекта в режиме администратора.
- Вход пользователей выполняется через официальный Steam OpenID; пароль Steam сайт не получает.
- Права администратора выдаются только SteamID64 из `STEAM_ADMIN_IDS`.
- В профиле можно привязать или отвязать Discord через OAuth2; пароль Discord сайт не получает.
- Только администратор может создавать, редактировать и удалять проекты.
- Проекты хранятся в Cloudflare D1, изображения — в Cloudflare R2.
- Пароли приватных проектов хранятся в виде PBKDF2-хеша; сессии Steam подписываются секретом `AUTH_SECRET`.

## Важно

Это уже не локальный HTML-файл. Для общей ссылки нужны аккаунты Cloudflare и GitHub, а также созданные ресурсы D1 и R2. Сам сайт из этой среды в ваш Cloudflare-аккаунт опубликовать нельзя: для этого требуется авторизация владельца аккаунта.

## 1. Подготовь GitHub

1. Создай приватный или публичный репозиторий на GitHub, например `dawnline-workshop`.
2. Загрузи в корень репозитория все файлы и папку `functions` из этого проекта.
3. Убедись, что `index.html`, `wrangler.toml`, `schema.sql` и `functions/` лежат в корне.

## 2. Создай ресурсы Cloudflare

В Cloudflare Dashboard открой **Workers & Pages**.

1. Создай D1 database с именем `dawnline-workshop-db`.
2. Открой D1 → созданную базу → Console и выполни SQL из файла `schema.sql`.
3. Создай R2 bucket с именем `dawnline-workshop-images`.

В `wrangler.toml` замени `REPLACE_WITH_YOUR_D1_DATABASE_ID` на Database ID из настроек D1.

## 3. Подключи Pages к GitHub

1. Cloudflare Dashboard → **Workers & Pages** → **Create application** → **Pages** → **Connect to Git**.
2. Выбери GitHub и репозиторий `dawnline-workshop`.
3. Framework preset: **None**.
4. Build command: оставь пустым (или `exit 0`).
5. Build output directory: `.`
6. Нажми **Save and Deploy**.

Нужна именно Git-интеграция: проект использует Pages Functions в папке `functions/`. Обычная загрузка статических файлов через Drag & Drop для этого варианта не подходит.

## 4. Подключи D1 и R2 к Pages

В настройках Pages-проекта найди **Settings → Functions → Bindings** и добавь:

- D1 database: Variable name `DB`, выбери `dawnline-workshop-db`.
- R2 bucket: Variable name `IMAGES`, выбери `dawnline-workshop-images`.

Сохрани изменения и запусти новое deployment.

## 5. Задай секреты

Pages project → **Settings → Variables and Secrets** → Production:

- `AUTH_SECRET` — длинная случайная строка минимум 32 случайных символа. Не используй пароль от Cloudflare.
- `STEAM_ADMIN_IDS` — список SteamID64 администраторов через запятую, например `76561198000000000`. Узнать SteamID64 можно через профиль Steam или сервисы просмотра SteamID.
- `DISCORD_CLIENT_ID` — Application ID Discord-приложения.
- `DISCORD_CLIENT_SECRET` — OAuth2 Client Secret Discord-приложения.

Для Discord создай приложение в [Discord Developer Portal](https://discord.com/developers/applications), открой OAuth2 и добавь Redirect URL точно в таком виде: `https://ТВОЙ-ДОМЕН/api/auth/discord/callback` (замени домен на адрес Cloudflare Pages). Скопируй Client ID и Client Secret в Cloudflare Secrets.

Сохрани и сделай новое deployment. Не помещай эти значения в `index.html`, GitHub или публичные сообщения. Steam OpenID работает без Steam API Key и не запрашивает пароль Steam.

## 6. Открой сайт

После успешного deployment Cloudflare выдаст адрес вида:

`https://dawnline-workshop.pages.dev`

Нажми **Войти через Steam**. Добавь свой SteamID64 в `STEAM_ADMIN_IDS`, чтобы получить права администратора. Обычные пользователи также могут войти через Steam, но без этого списка не смогут редактировать проекты. В профиле доступна привязка Discord.

### Приватный проект

1. Создай проект и выбери видимость «Приватный — по паролю».
2. Задай пароль проекта.
3. Сохрани проект.
4. Открой его карточку и нажми «Скопировать ссылку».
5. Отправь человеку ссылку и пароль отдельно.

Приватный проект не показывается в общем списке и его содержимое/изображения проверяются сервером.

## Резервное копирование

Для надёжности периодически экспортируй базу D1 и храни копии отдельно. Также включи защиту GitHub-репозитория и не публикуй секреты.
