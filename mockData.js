// Mock data for the dashboard
const mockData = {
    totals: {
        sold: 35,
        reserved: 20,
        available: 150,
        revenue: 85000000
    },
    salesByMonth: [
        { month: "Jan", value: 3000000 },
        { month: "Feb", value: 4000000 },
        { month: "Mar", value: 5500000 },
        { month: "Apr", value: 4800000 },
        { month: "May", value: 6200000 },
        { month: "Jun", value: 5900000 },
        { month: "Jul", value: 7100000 },
        { month: "Aug", value: 6800000 },
        { month: "Sep", value: 7500000 },
        { month: "Oct", value: 8200000 }
    ],
    projectBreakdown: [
        { name: "MVLC", sold: 15, reserved: 10, available: 200 },
        { name: "MSCC", sold: 8, reserved: 5, available: 70 },
        { name: "ERHD", sold: 12, reserved: 5, available: 50 }
    ],
    recentReservations: [
        {
            client: "Juan Dela Cruz",
            project: "MVLC",
            status: "Reserved",
            amount: 2500000,
            date: "2025-10-20"
        },
        {
            client: "Maria Santos",
            project: "MSCC",
            status: "Sold",
            amount: 3200000,
            date: "2025-10-18"
        },
        {
            client: "Robert Tan",
            project: "ERHD",
            status: "Reserved",
            amount: 2800000,
            date: "2025-10-15"
        }
    ],
    agents: [
        {
            name: "John Cruz",
            manager: "Mike Santos",
            lotsSold: 8,
            totalTCP: 12500000,
            lastSaleDate: "2025-10-15"
        },
        {
            name: "Sarah Garcia",
            manager: "Mike Santos",
            lotsSold: 6,
            totalTCP: 9800000,
            lastSaleDate: "2025-10-12"
        },
        {
            name: "Mark Reyes",
            manager: "Anna Lim",
            lotsSold: 5,
            totalTCP: 8500000,
            lastSaleDate: "2025-10-10"
        }
    ],
    followUps: [
        {
            client: "Pedro Morales",
            project: "MVLC",
            agent: "John Cruz",
            followUpDate: "2025-10-24",
            status: "Pending",
            remarks: "Second site visit scheduled"
        },
        {
            client: "Lisa Go",
            project: "MSCC",
            agent: "Sarah Garcia",
            followUpDate: "2025-10-25",
            status: "Pending",
            remarks: "Following up on payment schedule"
        }
    ],
    announcements: [
        {
            title: "October Promo: Free Transfer Fees",
            content: "Applies to spot down payments only.",
            author: "Admin",
            date: "2025-10-12"
        },
        {
            title: "New Phase Launch: ERHD Block C",
            content: "Pre-selling rates available until November 30.",
            author: "Sales Director",
            date: "2025-10-10"
        }
    ],
    inventory: [
        {
            project: "MVLC",
            lots: [
                {
                    lotNumber: "A-123",
                    size: 150,
                    pricePerSqm: 15000,
                    category: "Premium",
                    status: "Available",
                    lastUpdated: "2025-10-15"
                },
                {
                    lotNumber: "A-124",
                    size: 120,
                    pricePerSqm: 14000,
                    category: "Standard",
                    status: "Reserved",
                    lastUpdated: "2025-10-18"
                }
            ]
        },
        {
            project: "MSCC",
            lots: [
                {
                    lotNumber: "B-101",
                    size: 180,
                    pricePerSqm: 18000,
                    category: "Premium",
                    status: "Sold",
                    lastUpdated: "2025-10-10"
                }
            ]
        }
    ]
};

// Expose mock data on the window object so other scripts can reliably access it
window.mockData = mockData;