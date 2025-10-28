const CONFIG = {
    // Supabase プロジェクト設定
    supabase: {
        projectUrl: 'https://fwmieqfezlagstigtrem.supabase.co',  // SupabaseプロジェクトURL
        anonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ3bWllcWZlemxhZ3N0aWd0cmVtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjE2NjM1MjIsImV4cCI6MjA3NzIzOTUyMn0.YytgJyhjThVCGw1FE3lbGLz2GEAE4ljyJt5_mdZTV8E',            // Supabase Anon/Public Key
        tableName: 'products_dd'                   // 使用するテーブル名
    },

    // Keepa Edge Function 設定（任意）
    // JAN→ASIN候補の自動取得を使う場合のみ設定
    keepa: {
        functionUrl: '',  // Edge Function URL（任意）
        functionKey: ''   // Edge Function Secret（任意）
    }
};
