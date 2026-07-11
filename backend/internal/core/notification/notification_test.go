package notification_test

import (
	"context"
	"strings"
	"testing"

	"github.com/meagrup/agencyapp/backend/internal/core/notification"
	"github.com/meagrup/agencyapp/backend/internal/testutil"
)

func TestCatalog_AllThirteenEventsRegistered(t *testing.T) {
	c := notification.NewCatalog()
	if got := len(c.Events()); got != 13 {
		t.Fatalf("catalog has %d events, want 13", got)
	}
}

func TestEmit_BlockRequestNotifiesDivisionLeads(t *testing.T) {
	d := testutil.DB(t)
	testutil.Clean(t, d)
	ctx := context.Background()

	// Two Sales leads + one Sales staff (actor). Only leads should be notified.
	testutil.InsertRoleMapping(t, d, "Sales", "Sales Head", "Sales", "lead")
	testutil.InsertRoleMapping(t, d, "Sales", "Sales Executive", "Sales", "staff")
	testutil.InsertEmployee(t, d, "L1", "Lead One", "l1@mea.co.id", "Sales", "Sales Head", true)
	testutil.InsertEmployee(t, d, "L2", "Lead Two", "l2@mea.co.id", "Sales", "Sales Head", true)
	testutil.InsertEmployee(t, d, "S1", "Staff One", "s1@mea.co.id", "Sales", "Sales Executive", true)

	c := notification.NewCatalog()
	notified, err := c.Emit(ctx, d, notification.Emission{
		Event: notification.EvBlockRequestSubmitted, EntityType: "demo_task", EntityID: "DEMO-1",
		Actor: "S1", Division: "Sales", DeepLink: "/demo-tasks/DEMO-1",
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(notified) != 2 {
		t.Fatalf("notified %v, want the 2 leads", notified)
	}

	// Each lead has an unread notification; staff actor has none.
	for _, l := range []string{"L1", "L2"} {
		n, err := notification.UnreadCount(ctx, d, l)
		if err != nil {
			t.Fatal(err)
		}
		if n != 1 {
			t.Errorf("%s unread=%d want 1", l, n)
		}
	}
	if n, _ := notification.UnreadCount(ctx, d, "S1"); n != 0 {
		t.Errorf("actor S1 unread=%d want 0", n)
	}
}

func TestEmit_ExplicitRecipient_AndMarkRead(t *testing.T) {
	d := testutil.DB(t)
	testutil.Clean(t, d)
	ctx := context.Background()
	testutil.InsertEmployee(t, d, "R1", "Requester", "r1@mea.co.id", "Sales", "Sales Executive", true)

	c := notification.NewCatalog()
	if _, err := c.Emit(ctx, d, notification.Emission{
		Event: notification.EvBlockRequestDecided, EntityType: "demo_task", EntityID: "DEMO-1",
		Actor: "L1", ExplicitRecipients: []string{"R1"},
	}); err != nil {
		t.Fatal(err)
	}
	list, err := notification.List(ctx, d, "R1", true)
	if err != nil {
		t.Fatal(err)
	}
	if len(list) != 1 {
		t.Fatalf("want 1 notification, got %d", len(list))
	}
	if err := notification.MarkRead(ctx, d, list[0].ID, "R1"); err != nil {
		t.Fatal(err)
	}
	if n, _ := notification.UnreadCount(ctx, d, "R1"); n != 0 {
		t.Fatalf("after mark-read unread=%d want 0", n)
	}
}

func TestNotifications_DeleteBlockedAtStorage(t *testing.T) {
	d := testutil.DB(t)
	testutil.Clean(t, d)
	ctx := context.Background()
	testutil.InsertEmployee(t, d, "R1", "Requester", "r1@mea.co.id", "Sales", "Sales Executive", true)
	c := notification.NewCatalog()
	if _, err := c.Emit(ctx, d, notification.Emission{
		Event: notification.EvBlockRequestDecided, EntityType: "demo_task", EntityID: "DEMO-1",
		Actor: "L1", ExplicitRecipients: []string{"R1"},
	}); err != nil {
		t.Fatal(err)
	}
	var id int64
	if err := d.QueryRow(`SELECT id FROM notifications LIMIT 1`).Scan(&id); err != nil {
		t.Fatal(err)
	}
	if _, err := d.Exec(`DELETE FROM notifications WHERE id=?`, id); err == nil {
		t.Fatal("expected notification DELETE to be blocked at storage layer")
	} else if !strings.Contains(err.Error(), "not deletable") {
		t.Fatalf("unexpected delete error: %v", err)
	}
}
