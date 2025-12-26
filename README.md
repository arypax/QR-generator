# QR-generator

Генератор QR кодов с поддержкой логотипов, пагинации и управления ссылками.

## Возможности

- Генерация QR-кодов с логотипом АЛЭС (градиентный дизайн)
- Загрузка кастомных логотипов
- Редактирование названий и ссылок
- Поиск по ID, названию и ссылке
- Пагинация (10 записей на страницу)
- Автосохранение изменений

## Установка

```bash
npm install
```

## Настройка

Создайте файл `.env` на основе `env.example.txt`:

```
PORT=3000
BASE_URL=http://localhost:3000
ADMIN_TOKEN=your-secret-token
```

## Запуск

```bash
npm start
```

Приложение будет доступно по адресу `http://localhost:3000/admin?token=your-secret-token`

## Деплой

### Важно про GitHub Pages

GitHub Pages умеет хостить **только статические сайты** (HTML/CSS/JS). Это приложение — **Node.js/Express + SQLite**, поэтому на GitHub Pages оно работать не будет без потери функционала.

Правильная схема: **репозиторий на GitHub → деплой на хостинг Node.js** (Render/Railway/Vercel). При желании GitHub Pages можно использовать как “витрину/редирект”.

### Render (рекомендуется для SQLite без потери данных)

- На бесплатном Render **нельзя подключать disk**, поэтому для “без потери данных” нужно использовать внешнюю БД.
- В проект добавлена поддержка Postgres через переменную `DATABASE_URL` (например Supabase).
- В Render: New → Blueprint → выбрать репозиторий → задать `ADMIN_TOKEN` и `DATABASE_URL` → Deploy.

#### Быстрый вариант Postgres (Supabase)

1. Создай проект в Supabase и возьми строку подключения (Connection string / `DATABASE_URL`)
2. В Render добавь переменную `DATABASE_URL`
3. После деплоя данные и кастомные логотипы будут храниться в Postgres (не на диске).

### Vercel

1. Установите Vercel CLI: `npm i -g vercel`
2. Запустите: `vercel`
3. Настройте переменные окружения в панели Vercel:
   - `ADMIN_TOKEN` - ваш секретный токен
   - `BASE_URL` - URL вашего деплоя (опционально)

### Railway

1. Подключите репозиторий на [Railway](https://railway.app)
2. Настройте переменные окружения
3. Railway автоматически задеплоит приложение

### Render

1. Создайте новый Web Service на [Render](https://render.com)
2. Подключите репозиторий
3. Настройте переменные окружения
4. Build Command: `npm install`
5. Start Command: `npm start`